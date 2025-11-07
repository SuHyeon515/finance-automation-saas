# api/main.py
import io
import os
from typing import Optional, List, Dict, Any, Literal
import httpx
import numpy as np
import pandas as pd
from datetime import datetime,timezone,timedelta
from calendar import monthrange
from dateutil.relativedelta import relativedelta
from fastapi import FastAPI, UploadFile, File, Form, Header,APIRouter, HTTPException, Depends, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from supabase import create_client, Client
from openai import OpenAI
from dotenv import load_dotenv
from urllib.parse import quote
from pydantic import BaseModel, field_validator
import re
import jwt
import requests
import json

load_dotenv()

from utils import unify_columns, normalize_vendor, apply_rules, load_spreadsheet


# === ENV ===
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', '*').split(',') if o.strip()]
DEV_USER_ID = os.environ.get('DEV_USER_ID')

if not all([SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY]):
    raise RuntimeError('환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)가 필요합니다.')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

app = FastAPI()

allowed_origins = [
    "https://finance-automation-saas-um91.vercel.app",
    "https://finance-automation-saas.vercel.app",
    "http://localhost:3000",
    "https://finance-automation-saas.onrender.com"
]

env_origins = os.getenv("ALLOWED_ORIGINS")
if env_origins:
    allowed_origins.extend([o.strip() for o in env_origins.split(",") if o.strip()])
else:
    print("⚠️ ALLOWED_ORIGINS 환경변수 없음 → 기본 허용 목록 사용")

allowed_origins = list(set(allowed_origins))  # 중복 제거

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.options("/{path:path}")
async def options_handler(path: str):
    return Response(status_code=200)

@app.middleware("http")
async def log_origin(request, call_next):
    origin = request.headers.get("origin")
    print(f"🌐 요청 Origin: {origin}")
    response = await call_next(request)
    print(f"✅ 응답 Access-Control-Allow-Origin: {response.headers.get('access-control-allow-origin')}")
    return response


# === Helper ===
def build_download_headers(filename: str) -> dict:
    ascii_fallback = "download.xlsx"
    if all(ord(c) < 128 for c in filename):
        ascii_fallback = filename
    return {
        "Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"
    }

# === Auth ===
SUPABASE_JWT_PUBLIC_KEY = None
try:
    jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    jwks = requests.get(jwks_url, timeout=5).json()
    if jwks.get("keys"):
        SUPABASE_JWT_PUBLIC_KEY = jwt.algorithms.RSAAlgorithm.from_jwk(jwks["keys"][0])
        print("🔑 Supabase JWT public key 로드 완료")
except Exception as e:
    print("⚠️ Supabase JWT public key 로드 실패:", e)

async def get_user_id(authorization: Optional[str]) -> str:
    """
    ✅ Supabase Auth 토큰을 로컬에서 decode (매 요청시 외부 HTTP 호출 없음)
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        if DEV_USER_ID:
            return DEV_USER_ID
        raise HTTPException(status_code=401, detail="Missing Authorization Bearer token")

    token = authorization.split(" ", 1)[1]

    # 1️⃣ Public key가 없으면 fallback (예: local dev)
    if SUPABASE_JWT_PUBLIC_KEY is None:
        url = f"{SUPABASE_URL}/auth/v1/user"
        headers = {"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY}
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid token")
            return r.json()["id"]

    # 2️⃣ 정상 케이스: JWT 로컬 검증
    try:
        payload = jwt.decode(token, SUPABASE_JWT_PUBLIC_KEY, algorithms=["RS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("user_id(sub) 누락")
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception as e:
        print("⚠️ JWT decode 실패:", e)
        raise HTTPException(status_code=401, detail="Invalid token")
    
async def get_user_role(authorization: Optional[str]) -> Optional[str]:
    """JWT 토큰에서 role(admin/viewer/user)을 추출"""
    if not authorization:
        return None
    try:
        token = authorization.replace("Bearer ", "")
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("role")
    except Exception as e:
        print("⚠️ get_user_role 오류:", e)
        return None

# === Auth ===
async def get_role(user_id: str) -> str:
    """
    Supabase profiles 테이블에서 role(admin/viewer/user) 조회.
    service_role 키로 호출해 RLS 우회.
    """
    try:
        # ✅ 서비스 키로 다시 클라이언트 생성 (RLS 무시)
        admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        res = admin.table('profiles').select('role').eq('id', user_id).execute()

        if res.data and len(res.data) > 0:
            role = res.data[0].get('role', 'user')
            print(f"✅ [get_role] user_id={user_id}, role={role}")
            return role

        print(f"⚠️ [get_role] user_id={user_id} 결과 없음")
        return 'user'

    except Exception as e:
        print(f"❌ [get_role 오류]: {e}")
        return 'user'

# === Models ===
class ReportFilter(BaseModel):
    year: int
    month: int
    branch: Optional[str] = None
    category: Optional[str] = None
    granularity: Literal['day','week','month','year'] = 'month'

class AssignPayload(BaseModel):
    transaction_ids: List[str]
    category: str
    category_l1: Optional[str] = None
    category_l2: Optional[str] = None
    category_l3: Optional[str] = None
    memo: Optional[str] = None
    is_fixed: Optional[bool] = None
    save_rule: bool = False
    rule_keyword_source: Literal['vendor','description','memo','any'] = 'any'

class CategoryCreate(BaseModel):
    l1: str
    l2: Optional[str] = None
    l3: Optional[str] = None
    is_fixed: bool = False

class SalonKPIInput(BaseModel):
    total_sales: float
    pass_paid_total: float
    realized_from_pass: float
    pass_balance: float
    pay_sales: float
    card_sales: float
    visitors_total: int
    fixed_expense: float
    variable_expense: float
    interns: int

    # ✅ 추가 필드 — 선택적(optional)로 변경
    monthly_income: Optional[Dict[str, float]] = None
    monthly_fixed: Optional[Dict[str, float]] = None
    monthly_variable: Optional[Dict[str, float]] = None



# === Routes ===
@app.get('/health')
async def health():
    return {"status": "ok"}

@app.get('/meta/branches')
async def meta_branches(authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)
    names = set()

    try:
        if role in ['admin', 'viewer']:
            res1 = supabase.table('branches').select('name').execute()
            for r in res1.data or []:
                if r.get('name'):
                    names.add(r['name'])
            
            res2 = supabase.table('transactions').select('branch').neq('branch', '').execute()
            for r in res2.data or []:
                if r.get('branch'):
                    names.add(r['branch'])
        else:
            res1 = supabase.table('branches').select('name').eq('user_id', user_id).execute()
            for r in res1.data or []:
                if r.get('name'):
                    names.add(r['name'])
            
            res2 = supabase.table('transactions').select('branch').eq('user_id', user_id).neq('branch', '').execute()
            for r in res2.data or []:
                if r.get('branch'):
                    names.add(r['branch'])

    except Exception as e:
        print(f"⚠️ branches 조회 오류: {e}")

    # ✅ 항상 실행되도록 try 밖으로 이동
    print(f"✅ [meta/branches] user_id={user_id}, role={role}, count={len(names)}, names={list(names)}")
    return sorted(list(names))

@app.get('/me')
async def me(authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    print(f"🔍 /me 요청 — authorization header: {authorization}")
    print(f"🔍 /me 요청 — 해석된 user_id: {user_id}")
    role = await get_role(user_id)
    print(f"🔍 /me 요청 — get_role 반환값: {role}")
    return {"user_id": user_id, "role": role}

# === Upload ===
@app.post('/upload')
async def upload_file(
    file: UploadFile = File(...),
    branch: str = Form(...),
    period_year: int = Form(...),
    period_month: int = Form(...),
    start_month: Optional[str] = Form(None),
    end_month: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None)
):
    """
    📂 파일 업로드 (단일 + 다중월 자동 분리 완전 지원)
    - start_month, end_month 지정 시: 해당 범위 내 월별 자동 분리 저장
    - 지정 안 하면: 기존 단일 월 업로드 그대로
    """
    user_id = await get_user_id(authorization)
    content = await file.read()

    print(f"📤 업로드 요청: user={user_id}, branch={branch}, start={start_month}, end={end_month}")

    # 0️⃣ 새 지점 자동 등록
    try:
        existing = (
            supabase.table('branches')
            .select('id')
            .eq('user_id', user_id)
            .eq('name', branch)
            .limit(1)
            .execute()
        )
        if not existing.data:
            supabase.table('branches').upsert(
                {'user_id': user_id, 'name': branch},
                on_conflict='user_id,name'
            ).execute()
    except Exception as e:
        print(f"⚠️ branches 자동등록 중 오류: {e}")

    # 1️⃣ 엑셀 로드 + 컬럼 정규화
    try:
        df_raw = load_spreadsheet(content, file.filename)
        df = unify_columns(df_raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"파일 읽기 오류: {e}")

    df = df.replace([np.nan, np.inf, -np.inf], None)
    if 'memo' not in df.columns:
        df['memo'] = ''
    else:
        df['memo'] = df['memo'].fillna('')
    df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0.0)
    df = df[df['date'].notna()].copy()

    # 2️⃣ 기간 지정 필터 (선택적)
    if start_month and end_month:
        start_date = pd.to_datetime(f"{start_month}-01")
        end_date = pd.Period(end_month).end_time  # ✅ 수정됨
        before = len(df)
        df = df[(df['date'] >= start_date) & (df['date'] <= end_date)]
        print(f"🗓️ 기간 필터 적용: {start_month} ~ {end_month} ({before} → {len(df)}건)")
    else:
        print("🗓️ 단일 월 업로드로 처리")

    if df.empty:
        raise HTTPException(status_code=400, detail="선택된 기간에 해당하는 거래내역이 없습니다.")

    # 3️⃣ 규칙 적용
    df['vendor_normalized'] = df['description'].apply(normalize_vendor)
    rules = (
        supabase.table('rules')
        .select('*')
        .eq('user_id', user_id)
        .eq('is_active', True)
        .order('priority', desc=True)
        .execute()
        .data or []
    )
    applied = [apply_rules(row.to_dict(), rules) for _, row in df.iterrows()]
    df = pd.concat([df, pd.DataFrame(applied)], axis=1)

    # ✅ 여기 추가
    df['date'] = pd.to_datetime(df['date'], errors='coerce')  # ⬅️ 추가
    df = df[df['date'].notna()].copy()                       # ⬅️ 추가

    # 4️⃣ 월별 자동 분리 (여러 달 업로드 지원)
    df['year'] = df['date'].dt.year
    df['month'] = df['date'].dt.month
    month_groups = df.groupby(['year', 'month'])
    multi_upload = bool(start_month and end_month)

    total_tx = 0
    total_uploads = 0

    for (y, m), group in month_groups:
        # ✅ 단일 업로드 모드일 때는 지정 월만 처리
        if not multi_upload and (y != period_year or m != period_month):
            continue

        print(f"📦 [{branch}] {y}-{m:02d} 데이터 {len(group)}건 저장 중...")

        # ✅ 여기 수정됨 (upload_data 먼저 정의하고 변환)
        upload_data = {
            'user_id': user_id,
            'branch': branch,
            'period_year': int(y),
            'period_month': int(m),
            'original_filename': str(file.filename),
            'total_rows': int(len(group)),
            'status': 'processed',
        }
        if start_month:
            upload_data['start_month'] = start_month
        if end_month:
            upload_data['end_month'] = end_month

        # ✅ numpy.int64, np.float64 등 안전 변환
        upload_data = {
            k: (int(v) if isinstance(v, (np.integer,)) else v)
            for k, v in upload_data.items()
        }

        up = supabase.table('uploads').insert(upload_data).execute()
        upload_id = up.data[0]['id']

        # 5️⃣ 거래내역 저장
        recs = []
        for _, r in group.iterrows():
            tx_date = pd.to_datetime(r['date'], errors="coerce").normalize()  # ✅ 날짜만 유지
            recs.append({
                'user_id': user_id,
                'upload_id': upload_id,
                'branch': branch,
                'tx_date': tx_date.isoformat(),  # ✅ 시간대 변환 제거
                'description': (r.get('description') or ''),
                'memo': (r.get('memo') or ''),
                'amount': float(r.get('amount', 0) or 0),
                'balance': float(r.get('balance', 0) or 0),
                'category': (r.get('category') or '미분류'),
                'vendor_normalized': r.get('vendor_normalized'),
                'is_fixed': bool(r.get('is_fixed', False))
            })

        for i in range(0, len(recs), 500):
            supabase.table('transactions').insert(recs[i:i + 500]).execute()

        total_tx += len(group)
        total_uploads += 1

        # ✅ [자산 자동등록] (월별 마지막 잔액 기준)
        try:
            if 'balance' not in group.columns or group.empty:
                print(f"⚠️ {y}-{m} balance 없음 → 건너뜀")
                continue

            last_row = group.sort_values('date').iloc[-1]
            last_balance = float(last_row['balance'] or 0)
            memo_pattern = f"{y}년 {m}월 말 잔액 기준 자동등록"

            supabase.table('assets_log') \
                .delete() \
                .eq('user_id', user_id) \
                .eq('branch', branch) \
                .ilike('memo', f'%{memo_pattern}%') \
                .execute()

            next_y, next_m = (y + 1, 1) if m == 12 else (y, m + 1)
            created_at = datetime(next_y, next_m, 1, 0, 0, 0)

            supabase.table('assets_log').insert({
                'user_id': user_id,
                'branch': branch,
                'type': '수입',
                'direction': '증가',
                'category': f'{branch} 사업자통장',
                'amount': last_balance,
                'memo': memo_pattern,
                'created_at': created_at.isoformat()
            }).execute()

            print(f"✅ [{branch}] {y}-{m:02d} 자산 자동등록 완료 → {last_balance:,.0f}원")
        except Exception as e:
            print(f"⚠️ 자산 자동등록 오류 ({y}-{m}): {e}")

    print(f"🎯 총 {total_uploads}개월 / {total_tx}건 거래 저장 완료")

    # 6️⃣ 엑셀 결과 반환
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='transactions')
    out.seek(0)

    # 파일 이름 자동 지정
    if start_month and end_month:
        filename = f"processed_{branch}_{start_month}_{end_month}.xlsx"
    else:
        filename = f"processed_{branch}_{period_year}-{period_month:02d}.xlsx"

    headers = build_download_headers(filename)
    return Response(
        content=out.read(),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers=headers
    )


@app.get("/designer_salaries")
async def list_designer_salaries(
    branch: str = Query(...),
    start_month: str = Query(...),
    end_month: str = Query(...),
    authorization: Optional[str] = Header(None)
):
    user_id = await get_user_id(authorization)
    try:
        data = (
            supabase.table("designer_salaries")
            .select("name, rank, month, base_amount, extra_amount, total_amount, amount")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("month", start_month)
            .lte("month", end_month)
            .order("month", desc=False)
            .order("name", desc=False)
            .execute()
            .data
        )
        return data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

# @app.post('/upload')
# async def upload_file(
#     file: UploadFile = File(...),
#     branch: str = Form(...),
#     period_year: int = Form(...),
#     period_month: int = Form(...),
#     authorization: Optional[str] = Header(None)
# ):
#     user_id = await get_user_id(authorization)
#     content = await file.read()

#     # 0️⃣ 새 지점 자동 등록 (branches 테이블)
#     try:
#         if not user_id:
#             raise ValueError("user_id가 누락되어 branches에 NULL로 들어갈 수 있습니다.")

#         existing = (
#             supabase.table('branches')
#             .select('id')
#             .eq('user_id', user_id)
#             .eq('name', branch)
#             .limit(1)
#             .execute()
#         )

#         if not existing.data:
#             print(f"🆕 새 지점 자동 등록: {branch}")
#             supabase.table('branches').upsert(
#                 {'user_id': user_id, 'name': branch},
#                 on_conflict='user_id,name'
#             ).execute()
#     except Exception as e:
#         print(f"⚠️ branches 자동등록 중 오류: {e}")

#     # 1️⃣ Load
#     try:
#         df_raw = load_spreadsheet(content, file.filename)
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"파일 읽기 오류: {e}")

#     # 2️⃣ Normalize
#     try:
#         df = unify_columns(df_raw)
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"컬럼 정규화 오류: {e}")

#     # ✅ NaN/inf 정리 (JSON 오류 방지)
#     df = df.replace([np.nan, np.inf, -np.inf], None)

#     # ✅ memo 안전 처리
#     if 'memo' not in df.columns:
#         df['memo'] = ''
#     else:
#         df['memo'] = df['memo'].fillna('')
#     df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0.0)
#     df = df[df['date'].notna()].copy()

#     # 3️⃣ Vendor normalize + 기존 rules 적용
#     df['vendor_normalized'] = df['description'].apply(normalize_vendor)
#     rules = supabase.table('rules').select('*').eq('user_id', user_id).eq('is_active', True)\
#         .order('priority', desc=True).execute().data or []
#     applied = [apply_rules(row.to_dict(), rules) for _, row in df.iterrows()]
#     df = pd.concat([df, pd.DataFrame(applied)], axis=1)

#     # 4️⃣ 자동 규칙 학습 (기존 거래 기반: 카테고리 + 고정지출)
#     existing = supabase.table('transactions').select(
#         'vendor_normalized,description,category,is_fixed'
#     ).eq('user_id', user_id).neq('category', '미분류').execute().data or []

#     auto_map = {}
#     for row in existing:
#         key = (row.get('vendor_normalized') or row.get('description'))
#         if key:
#             auto_map[key.strip()] = {
#                 "category": row.get('category'),
#                 "is_fixed": bool(row.get('is_fixed', False))
#             }

#     # ✅ 5️⃣ 자동 분류 + 고정/변동 자동 반영
#     df['is_fixed'] = False  # 기본값: 변동지출
#     for i, r in df.iterrows():
#         key = (r.get('vendor_normalized') or r.get('description'))
#         if not key:
#             continue

#         match = auto_map.get(key.strip())
#         if match:
#             if not r.get('category') or r['category'] == '미분류':
#                 df.at[i, 'category'] = match.get('category', '미분류')
#             df.at[i, 'is_fixed'] = match.get('is_fixed', False)

#     # 6️⃣ Upload log
#     up = supabase.table('uploads').insert({
#         'user_id': user_id,
#         'branch': branch,
#         'period_year': period_year,
#         'period_month': period_month,
#         'original_filename': file.filename,
#         'total_rows': len(df),
#         'unclassified_rows': int(((df['category'].isna()) | (df['category'] == '미분류')).sum()),
#         'status': 'processed'
#     }).execute()
#     upload_id = up.data[0]['id']

#     # 7️⃣ Save transactions
#     recs = []
#     for _, r in df.iterrows():
#         amt = float(r.get('amount', 0) or 0)
#         bal = float(r.get('balance', 0) or 0)  # ✅ 잔액 컬럼 추가

#         recs.append({
#             'user_id': user_id,
#             'upload_id': upload_id,
#             'branch': branch,
#             'tx_date': str(r['date']) if r['date'] else None,
#             'description': (r.get('description') or ''),
#             'memo': (r.get('memo') or ''),
#             'amount': amt,
#             'balance': bal,                     # ✅ 추가됨
#             'category': (r.get('category') or '미분류'),
#             'vendor_normalized': r.get('vendor_normalized'),
#             'is_fixed': bool(r.get('is_fixed', False))
#         })

#     # ✅ Supabase에 저장
#     for i in range(0, len(recs), 500):
#         supabase.table('transactions').insert(recs[i:i + 500]).execute()

#     # ✅ [자산 자동등록] ==============================
#     try:
#         delete_after = datetime(period_year, period_month, 1) + relativedelta(months=1)
#         supabase.table('assets_log') \
#             .delete() \
#             .eq('user_id', user_id) \
#             .eq('branch', branch) \
#             .ilike('memo', '%자동등록%') \
#             .gte('created_at', delete_after.isoformat()) \
#             .execute()
        
#         print("📊 df.columns:", df.columns.tolist())
#         print("📈 balance 샘플:", df['balance'].head().tolist() if 'balance' in df.columns else '없음')
#         print("📅 df.shape:", df.shape)
#         print("🔍 branch:", branch, "user_id:", user_id)

#         if 'balance' in df.columns and not df.empty:
#             df['month'] = pd.to_datetime(df['date']).dt.to_period('M')

#             # ✅ 각 월별 마지막 날짜의 잔액 직접 추출
#             month_groups = df.groupby('month', as_index=False)
#             for _, group in month_groups:
#                 last_row = group.sort_values('date').iloc[-1]
#                 month_str = str(last_row['month'])
#                 last_balance = float(last_row['balance'] or 0)
#                 year, month = map(int, month_str.split('-'))

#                 # ✅ 다음 달 1일로 created_at 설정 (이월 기준)
#                 if month == 12:
#                     next_year, next_month = year + 1, 1
#                 else:
#                     next_year, next_month = year, month + 1

#                 created_at = datetime(next_year, next_month, 1, 0, 0, 0)

#                 # ✅ 실제 DB 저장 (여기서만 insert!)
#                 supabase.table('assets_log').insert({
#                     'user_id': user_id,
#                     'branch': branch or '미지정',
#                     'type': '수입',
#                     'direction': '증가',
#                     'category': f'{branch} 사업자통장',
#                     'amount': last_balance,
#                     'memo': f'{year}년 {month}월 말 잔액 기준 자동등록',
#                     'created_at': created_at.isoformat()
#                 }).execute()

#                 print(f"✅ {branch} {year}년 {month}월 → {next_year}-{next_month:02d}월 시작 잔액 {last_balance}")

#         else:
#             print("⚠️ balance 컬럼이 없거나 데이터가 비어 있음 → 자산 자동등록 건너뜀")

#     except Exception as e:
#         print(f"⚠️ 자산 자동등록 중 오류 발생: {e}")
#     # 8️⃣ Generate Excel
#     out = io.BytesIO()
#     with pd.ExcelWriter(out, engine='openpyxl') as writer:
#         df_out = df.copy()
#         df_out.rename(columns={
#             'date': '날짜', 'description': '내용', 'memo': '메모',
#             'amount': '금액', 'category': '카테고리', 'is_fixed': '고정지출여부'
#         }, inplace=True)
#         df_out.to_excel(writer, index=False, sheet_name='transactions')
#         summary = df_out.groupby(['카테고리'], dropna=False)['금액']\
#             .agg(['count', 'sum']).reset_index()
#         summary.to_excel(writer, index=False, sheet_name='summary')
#     out.seek(0)

#     safe_name = f"processed_{period_year}-{period_month:02d}_{branch}.xlsx"
#     headers = build_download_headers(safe_name)

#     return Response(
#         content=out.read(),
#         media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
#         headers=headers
#     )
class ManualSalaryItem(BaseModel):
    branch: str
    name: str
    rank: str
    month: str            # 'YYYY-MM'
    base_amount: float
    extra_amount: Optional[float] = 0.0
    total_amount: float

    @field_validator("month")
    @classmethod
    def _validate_month(cls, v: str) -> str:
        if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", v or ""):
            raise ValueError("month must be in 'YYYY-MM' format")
        return v

@app.post("/transactions/salary_manual_save")
async def salary_manual_save(
    items: List[ManualSalaryItem],
    authorization: Optional[str] = Header(None)
):
    """
    프론트의 '직접 입력형' 급여 저장 엔드포인트.
    - payload: ManualSalaryItem[] (branch, name, rank, month, base_amount, extra_amount, total_amount)
    - 작업:
        1) 각 항목에 대해 (user_id, branch, name, month) 중복 제거
        2) designer_salaries에 insert (amount=total_amount도 함께 채움)
    """
    user_id = await get_user_id(authorization)
    if not items:
        return {"ok": True, "inserted": 0}

    # 유효성/정규화
    cleaned: List[dict] = []
    for it in items:
        # 금액 음수 방지 및 None 안전화
        base = float(it.base_amount or 0)
        extra = float(it.extra_amount or 0)
        total = float(it.total_amount or (base + extra))

        cleaned.append({
            "user_id": user_id,
            "branch": (it.branch or "").strip(),
            "name": (it.name or "").strip(),
            "rank": (it.rank or "").strip(),
            "month": it.month,                 # 'YYYY-MM'
            "base_amount": base,
            "extra_amount": extra,
            "total_amount": total,
            "amount": total,                   # 기존 amount 컬럼도 동일 값으로 기록
            "tx_ids": [],                      # 수동 입력이므로 비움
        })

    # (유니크 보장) 같은 (user_id, branch, name, month) 기존 레코드 제거 후 삽입
    # - 유니크 인덱스를 걸어두었으면 upsert로 대체 가능
    inserted = 0
    try:
        # 1) 먼저 같은 키 조합을 한 번에 지워 중복 방지
        #    (Supabase의 delete IN 절은 or_.in_ 형태 없이 loop로 처리)
        for row in cleaned:
            supabase.table("designer_salaries") \
                .delete() \
                .eq("user_id", user_id) \
                .eq("branch", row["branch"]) \
                .eq("name", row["name"]) \
                .eq("month", row["month"]) \
                .execute()

        # 2) 벌크 인서트 (500개씩 청크)
        for i in range(0, len(cleaned), 500):
            chunk = cleaned[i:i+500]
            res = supabase.table("designer_salaries").insert(chunk).execute()
            inserted += len(res.data or [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"급여 저장 중 오류: {e}")

    return {"ok": True, "inserted": inserted}

@app.post("/transactions/salary_manual_delete")
async def salary_manual_delete(payload: dict, authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    branch = payload.get("branch")
    name = payload.get("name")
    month = payload.get("month")

    # print("🧾 [DELETE 요청 수신]", {"user_id": user_id, "branch": branch, "name": name, "month": month})

    if not (branch and name and month):
        raise HTTPException(status_code=400, detail="필수 필드 누락")

    try:
        res = (
            supabase.table("designer_salaries")
            .delete()
            .eq("user_id", user_id)
            .eq("branch", branch)
            .eq("name", name)
            .eq("month", month)
            .execute()
        )

        print("🧹 [Supabase 삭제 결과]", res)

        if getattr(res, "error", None):
            raise HTTPException(status_code=500, detail=f"삭제 실패: {res.error}")

        return {"success": True, "deleted": len(getattr(res, "data", []) or [])}
    except Exception as e:
        print("❌ [salary_manual_delete 오류]", e)
        raise HTTPException(status_code=500, detail=f"삭제 중 오류: {e}")
# (선택) 월 범위 조회 API — 프론트에서 한 화면에 보여줄 때 유용
@app.get("/designer_salaries")
async def list_designer_salaries(
    branch: str = Query(...),
    start_month: str = Query(..., description="YYYY-MM"),
    end_month: str = Query(..., description="YYYY-MM"),
    authorization: Optional[str] = Header(None)
):
    """
    지점 + 월 범위를 기준으로 디자이너 급여 전부 조회
    - 반환: name, rank, month, base_amount, extra_amount, total_amount, amount
    """
    user_id = await get_user_id(authorization)

    try:
        q = (
            supabase.table("designer_salaries")
            .select("name, rank, month, base_amount, extra_amount, total_amount, amount")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("month", start_month)
            .lte("month", end_month)
            .order("month", desc=False)
            .order("name", desc=False)
        )
        data = q.execute().data or []
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")
    
# === 업로드 내역 조회 (실시간 미분류 건수 포함) ===
@app.get('/uploads')
async def list_uploads(
    limit: int = 50, offset: int = 0,
    branch: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    authorization: Optional[str] = Header(None)
):
    user_id = await get_user_id(authorization)
    print("✅ [DEBUG] user_id =", user_id)

    # 1️⃣ 업로드 목록 조회
    q = supabase.table('uploads').select('*').eq('user_id', user_id)
    if branch:
        q = q.eq('branch', branch)
    if year:
        q = q.eq('period_year', year)
    if month:
        q = q.eq('period_month', month)
    q = q.order('created_at', desc=True).range(offset, offset + limit - 1)
    uploads = q.execute().data or []

    # 2️⃣ 각 업로드별 실시간 미분류 개수 계산
    for u in uploads:
        try:
            tx_data = supabase.table('transactions') \
                .select('id', count='exact') \
                .eq('upload_id', u['id']) \
                .eq('user_id', user_id) \
                .eq('category', '미분류') \
                .execute()
            u['unclassified_rows'] = tx_data.count or 0
        except Exception as e:
            print(f"⚠️ 미분류 건수 계산 중 오류 (upload_id={u['id']}):", e)
            u['unclassified_rows'] = u.get('unclassified_rows', 0) or 0

    # 3️⃣ 프론트가 기대하는 응답 구조로 반환
    return {
        "items": uploads,
        "count": len(uploads),
        "limit": limit,
        "offset": offset
    }

@app.post("/transactions/mark_fixed")
async def mark_fixed(data: dict, authorization: Optional[str] = Header(None)):
    print("📥 mark_fixed called:", data)
    try:
        # ✅ 토큰에서 user_id 추출
        user_id = await get_user_id(authorization)

        tx_id = data.get("transaction_id")
        is_fixed = data.get("is_fixed")

        if not tx_id:
            raise HTTPException(status_code=400, detail="transaction_id required")

        # ✅ Supabase 업데이트 (본인 데이터만 수정 가능)
        res = (
            supabase.table("transactions")
            .update({"is_fixed": is_fixed})
            .eq("id", tx_id)
            .eq("user_id", user_id)
            .execute()
        )

        if not res.data:
            print(f"⚠️ is_fixed 업데이트 실패: tx_id={tx_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="Transaction not found or unauthorized")

        print(f"✅ is_fixed 업데이트 완료: tx_id={tx_id}, user_id={user_id}, is_fixed={is_fixed}")
        return {"success": True, "id": tx_id, "is_fixed": is_fixed}

    except Exception as e:
        print(f"❌ mark_fixed 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ✅ 업로드 삭제 API
@app.delete("/uploads/{upload_id}")
async def delete_upload(upload_id: str):
    # 업로드 존재 확인
    upload = supabase.table("uploads").select("id").eq("id", upload_id).execute()
    if not upload.data:
        raise HTTPException(status_code=404, detail="Upload not found")

    # 해당 업로드에 연결된 거래 삭제
    supabase.table("transactions").delete().eq("upload_id", upload_id).execute()

    # 업로드 메타데이터 삭제
    supabase.table("uploads").delete().eq("id", upload_id).execute()

    return {"message": "Upload deleted successfully", "id": upload_id}
@app.get('/meta/category-suggestions')
async def category_suggestions(authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    rows = supabase.table('transactions')\
        .select('category')\
        .eq('user_id', user_id).neq('category','미분류').execute().data or []
    freq = {}
    for r in rows:
        c = (r.get('category') or '').strip()
        if c:
            freq[c] = freq.get(c, 0) + 1
    # 상위 50
    ordered = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:50]
    return [name for name, _ in ordered]
@app.get('/rules')
async def list_rules(authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    res = supabase.table('rules').select('id,keyword,target,category,is_fixed,priority')\
        .eq('user_id', user_id).eq('is_active', True).order('priority', desc=True).execute()
    return res.data or []
class RuleCreate(BaseModel):
    keyword: str
    target: Literal['vendor','description','memo','any'] = 'any'
    category: str
    is_fixed: bool = False
    priority: int = 100

@app.post('/rules')
async def create_rule(payload: RuleCreate, authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    kw = (payload.keyword or '').strip()
    if not kw:
        raise HTTPException(status_code=400, detail='keyword required')
    supabase.table('rules').insert({
        'user_id': user_id,
        'keyword': kw,
        'target': payload.target,
        'category': payload.category or '미분류',
        'is_active': True,
        'is_fixed': payload.is_fixed,
        'priority': payload.priority,
    }).execute()
    return {'ok': True}


# === 거래 목록 조회 (미분류 + 분류 완료 포함) ===
@app.get("/transactions/manage")
async def list_transactions(
    branch: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    authorization: Optional[str] = Header(None)
):
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)

    # ✅ admin/viewer는 모든 유저 데이터 접근 가능 (service-role 우회)
    if role in ["admin", "viewer"]:
        db_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        q = db_client.table("transactions").select(
            "id, user_id, branch, tx_date, description, amount, category, memo, is_fixed"
        )
    else:
        db_client = supabase
        q = db_client.table("transactions").select(
            "id, user_id, branch, tx_date, description, amount, category, memo, is_fixed"
        ).eq("user_id", user_id)

    # ✅ branch 필터
    if branch and branch.strip():
        q = q.ilike("branch", f"%{branch.strip()}%")

    # ✅ 날짜 필터
    if year and month:
        start_month = f"{year}-{month:02d}-01"
        end_month = (pd.Timestamp(start_month) + pd.offsets.MonthEnd(1)).strftime("%Y-%m-%d")

        q = q.gte("tx_date", start_month).lte("tx_date", end_month)
    elif year:
        q = q.gte("tx_date", f"{year}-01-01").lt("tx_date", f"{year + 1}-01-01")

    # ✅ 전체 데이터 페이징 가져오기 (1000건씩)
    all_data = []
    start = 0
    step = 1000

    while True:
        res = q.range(start, start + step - 1).execute()
        if not res.data:
            break
        all_data.extend(res.data)
        if len(res.data) < step:
            break
        start += step

    data = all_data
    print(f"📦 전체 거래 수집 완료: {len(data)}건")

    # ✅ 후처리: 문자열 → datetime 변환 (UTC→KST)
    for row in data:
        if row.get("tx_date"):
            try:
                row["tx_date"] = (
                    pd.to_datetime(row["tx_date"], utc=True)
                    .tz_convert("Asia/Seoul")
                    .strftime("%Y-%m-%d %H:%M:%S")
                )
            except Exception:
                pass
        row["memo"] = row.get("memo") or ""
        row["category"] = row.get("category") or "미분류"
        row["branch"] = row.get("branch") or ""
        row["is_fixed"] = bool(row.get("is_fixed", False))

    return {
        "items": data,
        "count": len(data),
        "limit": len(data),  # ✅ limit 제거
        "offset": 0
    }

# # === 거래 카테고리 / 메모 지정 ===
# @app.post('/transactions/assign')
# async def assign_category(
#     body: dict,
#     authorization: Optional[str] = Header(None)
# ):
#     """
#     {
#         "transaction_ids": ["uuid1", "uuid2", ...],
#         "category": "식비",
#         "memo": "점심 회식",
#         "save_rule": false
#     }
#     """
#     user_id = await get_user_id(authorization)
#     if not user_id:
#         raise HTTPException(status_code=401, detail="Unauthorized")

#     tx_ids = body.get("transaction_ids", [])
#     category = body.get("category")
#     memo = body.get("memo", "")
#     save_rule = body.get("save_rule", False)

#     if not tx_ids or not category:
#         raise HTTPException(status_code=400, detail="transaction_ids와 category는 필수입니다.")

#     # ✅ 카테고리 + 메모 업데이트
#     updates = {
#         "category": category,
#         "memo": memo,
#     }

#     # ✅ memo 기본값 보장
#     for row in data:
#         row['memo'] = row.get('memo', '') or ''
#         row['category'] = row.get('category', '') or ''
        
#     # ✅ Supabase bulk update
#     for tx_id in tx_ids:
#         supabase.table("transactions").update(updates).eq("id", tx_id).eq("user_id", user_id).execute()

#     # ✅ 선택적으로 규칙 저장
#     if save_rule:
#         supabase.table("rules").upsert({
#             "user_id": user_id,
#             "keyword": category,
#             "target": "description",
#             "category": category,
#             "is_active": True
#         }, on_conflict="user_id,keyword").execute()

#     return {"status": "ok", "updated": len(tx_ids)}

# === 자산 변동 로그 ===
@app.get("/assets_log")
async def get_assets_log(
    branch: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None)
):
    """부동자산(수동 등록) 로그 조회"""
    user_id = await get_user_id(authorization)

    query = supabase.table("assets_log").select("*").eq("user_id", user_id)
    if branch:
        query = query.eq("branch", branch)
    res = query.order("created_at", desc=True).execute()

    return {"items": res.data}


@app.post("/assets_log")
async def add_asset_log(
    payload: dict,
    authorization: Optional[str] = Header(None)
):
    """자산 로그 추가 (부동자산 수동 등록 포함)"""
    user_id = await get_user_id(authorization)

    supabase.table("assets_log").insert({
        "user_id": user_id,
        "type": payload.get("type"),
        "direction": payload.get("direction"),
        "category": payload.get("category"),
        "amount": payload.get("amount"),
        "memo": payload.get("memo", ""),
        "branch": payload.get("branch", None)  # ✅ 지점명 저장
    }).execute()

    return {"ok": True}


# === 자산 삭제 로그 ===
@app.delete("/assets_log/{id}")
async def delete_asset_log(
    id: str,
    authorization: Optional[str] = Header(None)
):
    """자산 로그 삭제"""
    user_id = await get_user_id(authorization)
    supabase.table("assets_log").delete().eq("id", id).eq("user_id", user_id).execute()
    return {"ok": True}

# ✅ 자동 급여 불러오기 API (수정판)
@app.get("/transactions/salary_auto_load")
async def salary_auto_load(
    branch: str = Query(...),
    start: str = Query(...),
    end: str = Query(...),
    authorization: Optional[str] = Header(None)
):
    """
    지정된 지점(branch)과 기간(start~end)에 해당하는 거래내역 중
    '월급' 키워드를 가진 거래만 불러와 자동 매핑.
    개별 거래(설명/내용) 단위로 모두 반환.
    """
    user_id = await get_user_id(authorization)

    try:
        # ✅ 1. Supabase 쿼리 (월급만 필터)
        res = (
            supabase.table("transactions")
            .select("category, amount, tx_date, description")
            .eq("user_id", user_id)
            .ilike("branch", f"%{branch}%")
            .gte("tx_date", f"{start}-01")
            .lte("tx_date", pd.Period(end).end_time.strftime("%Y-%m-%d"))
            .ilike("category", "%월급%")
            .execute()
        )

        rows = res.data or []
        print(f"📦 [DEBUG] 월급 rows ({branch}):", rows[:5])

        if not rows:
            return []

        # ✅ 2. DataFrame 변환
        df = pd.DataFrame(rows)
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
        df["month"] = pd.to_datetime(df["tx_date"]).dt.strftime("%Y-%m")

        # ✅ 3. 이름: description 그대로 사용 (없으면 '기타')
        df["name"] = df["description"].fillna("기타").astype(str).str.strip()

        # ✅ 4. 필드 매핑
        df["base"] = df["amount"]
        df["extra"] = 0
        df["sales"] = 0
        df["rank"] = "디자이너"

        # ✅ 5. 개별 거래 단위로 변환 (groupby 제거)
        results = [
            {
                "name": r["name"],
                "rank": r["rank"],
                "base": abs(float(r["base"])),
                "extra": 0,
                "sales": 0,
                "month": r["month"],
            }
            for _, r in df.iterrows()
        ]

        print(f"✅ [salary_auto_load] 결과 {len(results)}건 (월급 개별)")
        return results

    except Exception as e:
        print("❌ 자동 급여 불러오기 오류:", e)
        raise HTTPException(status_code=500, detail=str(e))
    
    
# === 유동자산 자동등록 로그 조회 ===
@app.get("/assets_log/liquid")
async def get_liquid_assets(
    authorization: Optional[str] = Header(None),
    branch: Optional[str] = Query(None)
):
    user_id = await get_user_id(authorization)

    query = (
        supabase.table("assets_log")
        .select("*")
        .eq("user_id", user_id)
        .ilike("memo", "%자동등록%")
    )

    # ✅ 지점 필터 추가
    if branch:
        query = query.eq("branch", branch)

    res = query.order("created_at", desc=True).execute()
    return {"items": res.data}

# === 규칙/카테고리 ===
@app.post("/transactions/assign")
async def assign_categories(
    payload: AssignPayload,
    authorization: Optional[str] = Header(None)
):
    user_id = await get_user_id(authorization)
    data = payload.model_dump()
    print("🧾 [assign] payload:", data)

    if not payload.transaction_ids:
        return {"ok": True, "updated": 0}

    update_fields = {
        "category": payload.category or "미분류",
        "category_l1": payload.category_l1,
        "category_l2": payload.category_l2,
        "category_l3": payload.category_l3,
    }

    # ✅ memo 필드 반영
    if payload.memo is not None:
        update_fields["memo"] = payload.memo.strip()

    if payload.is_fixed is not None:
        update_fields["is_fixed"] = payload.is_fixed

    for tid in payload.transaction_ids:
        supabase.table("transactions") \
            .update(update_fields) \
            .eq("user_id", user_id) \
            .eq("id", tid) \
            .execute()
        
    # === 룰 저장 ===
    if payload.save_rule:
        sample = (
            supabase.table("transactions")
            .select("description,memo,vendor_normalized")
            .eq("user_id", user_id)
            .eq("id", payload.transaction_ids[0])
            .single()
            .execute()
            .data
        )

        kw = (sample.get("vendor_normalized") or sample.get("description") or sample.get("memo") or "").strip()

        if kw:
            rule_data = {
                "user_id": user_id,
                "keyword": kw,
                "target": "any",
                "category": payload.category or "미분류",
                "is_fixed": payload.is_fixed if "is_fixed" in data and data["is_fixed"] is not None else None,
                "is_active": True,
                "priority": 100,
            }

            # ✅ None 값은 제거하고 삽입 (Supabase에서 에러 방지)
            clean_rule_data = {k: v for k, v in rule_data.items() if v is not None}
            supabase.table("rules").insert(clean_rule_data).execute()

    print(f"✅ [assign] update_fields={update_fields}")
    return {"ok": True, "updated": len(payload.transaction_ids)}

# === 리포트 ===
class ReportRequest(BaseModel):
    year: int
    month: Optional[int] = None
    branch: Optional[str] = None
    granularity: Literal['day', 'week', 'month'] = 'month'
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    start_month: Optional[int] = None
    end_month: Optional[int] = None


@app.post("/reports")
async def get_reports(req: ReportRequest, authorization: Optional[str] = Header(None)):
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)

    # === Use admin/service-role client for admin/viewer to bypass RLS ===
    # Note: service role key must never be exposed to clients.
    if role in ["admin", "viewer"]:
        db_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    else:
        db_client = supabase

    # === [0] Build base query (will run on db_client which may be admin or regular) ===
    query = db_client.table("transactions").select("*")

    # === Access rules: admin/viewer see all (no user_id filter); normal users restricted ===
    if role in ["admin", "viewer"]:
        if req.branch and req.branch.strip():
            query = query.ilike("branch", f"%{req.branch.strip()}%")
    else:
        query = query.eq("user_id", user_id)
        if req.branch and req.branch.strip():
            query = query.ilike("branch", f"%{req.branch.strip()}%")

    # ✅ 여기에 페이징 전체 가져오기 로직 넣기
    all_data = []
    start = 0
    step = 1000

    while True:
        res = query.range(start, start + step - 1).execute()
        if not res.data:
            break
        all_data.extend(res.data)
        if len(res.data) < step:
            break
        start += step

    data = all_data  # 👈 전체 데이터를 df로 넘김
    df = pd.DataFrame(data)

    if df.empty:
        print("⚠️ 리포트: 데이터 없음")
        return {
            "summary": {},
            "by_category": {},
            "by_fixed": [],
            "by_period": [],
            "income_details": [],
            "expense_details": []
        }

    # === Date conversion and cleaning ===
    df["tx_date"] = pd.to_datetime(df["tx_date"], errors="coerce")
    df = df.dropna(subset=["tx_date"])
    df["branch"] = df["branch"].astype(str).str.strip()

    # === Period (month-range) filtering (KST month logic) ===
    if req.start_month or req.end_month or req.month:
        start_m = int(req.start_month or req.month or 1)
        end_m = int(req.end_month or req.month or start_m)

        df["year"] = df["tx_date"].dt.year
        df["month"] = df["tx_date"].dt.month

        before_rows = len(df)
        df = df[(df["year"] == req.year) & (df["month"].between(start_m, end_m))]
        after_rows = len(df)

        print(f"🧩 월 기준 필터링: {req.year}-{start_m} ~ {req.year}-{end_m}")
        print(f"📊 필터 전 행 수: {before_rows}, 필터 후 행 수: {after_rows}")

    elif req.year:
        df = df[df["tx_date"].dt.year == req.year]

    # === Optional day-range filtering ===
    if req.granularity == "day" and req.start_date and req.end_date:
        start = pd.to_datetime(req.start_date)
        end = pd.to_datetime(req.end_date)
        df = df[(df["tx_date"] >= start) & (df["tx_date"] <= end)]

    # === Normalize amounts & categories, remove zeros ===
    df["amount"] = (
        df["amount"]
        .astype(str)
        .str.replace(r"[^0-9\-\.\+]", "", regex=True)
        .replace("", "0")
        .astype(float)
    )
    df["category"] = df["category"].fillna("미분류").replace("", "미분류")
    df = df[df["amount"] != 0]
    df["is_fixed"] = df.get("is_fixed", False)

    print("💰 금액 합계 검증:", df["amount"].sum(), "건수:", len(df))

    # === Sorting ===
    df = df.sort_values("tx_date", ascending=False)

    # === Summary stats ===
    total_in = df[df["amount"] > 0]["amount"].sum()
    total_out = df[df["amount"] < 0]["amount"].sum()
    summary = {
        "total_in": float(total_in),
        "total_out": float(total_out),
        "net": float(total_in + total_out),
    }

    # === By category aggregates ===
    by_category = {
        "income": (
            df[df["amount"] > 0]
            .groupby("category", dropna=False)["amount"]
            .sum()
            .reset_index()
            .rename(columns={"amount": "sum"})
            .to_dict("records")
        ),
        "fixed_expense": (
            df[(df["amount"] < 0) & (df["is_fixed"] == True)]
            .groupby("category", dropna=False)["amount"]
            .sum()
            .reset_index()
            .rename(columns={"amount": "sum"})
            .to_dict("records")
        ),
        "variable_expense": (
            df[(df["amount"] < 0) & (df["is_fixed"] == False)]
            .groupby("category", dropna=False)["amount"]
            .sum()
            .reset_index()
            .rename(columns={"amount": "sum"})
            .to_dict("records")
        ),
    }

    # === Fixed vs variable totals ===
    by_fixed = (
        df.groupby("is_fixed")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "sum"})
        .to_dict("records")
    )

    # === Period grouping (week/month/day) ===
    if req.granularity == "week":
        df["period"] = (
            df["tx_date"] - pd.to_timedelta(df["tx_date"].dt.weekday, unit="D")
        ).dt.strftime("%Y-%m-%d")
    elif req.granularity == "month":
        df["period"] = df["tx_date"].dt.strftime("%Y-%m")
    else:
        df["period"] = df["tx_date"].dt.strftime("%Y-%m-%d")

    by_period = (
        df.groupby("period")
        .agg(
            total_in=("amount", lambda x: x[x > 0].sum()),
            total_out=("amount", lambda x: x[x < 0].sum()),
            fixed_out=("amount", lambda x: x[(x < 0) & (df.loc[x.index, "is_fixed"] == True)].sum()),
            variable_out=("amount", lambda x: x[(x < 0) & (df.loc[x.index, "is_fixed"] == False)].sum()),
            net=("amount", "sum"),
        )
        .reset_index()
        .sort_values("period")
        .to_dict("records")
    )

    # === Details ===
    income_details = (
        df[df["amount"] > 0]
        .sort_values("tx_date", ascending=False)
        [["tx_date", "description", "amount", "category", "memo", "is_fixed"]]
        .fillna({"memo": ""})
        .to_dict("records")
    )
    expense_details = (
        df[df["amount"] < 0]
        .sort_values("tx_date", ascending=False)
        [["tx_date", "description", "amount", "category", "memo", "is_fixed"]]
        .fillna({"memo": ""})
        .to_dict("records")
    )

    # === Debug logs ===
    print(f"✅ [REPORTS] user_id={user_id}, role={role}, branch={req.branch}, rows={len(df)}")
    print("📅 [최근 거래 5건]")
    print(df[["tx_date", "description", "amount", "category"]].head(5))
    print("📅 [가장 오래된 거래 5건]")
    print(df[["tx_date", "description", "amount", "category"]].tail(5))

    # === Return ===
    return {
        "summary": summary,
        "by_category": by_category,
        "by_fixed": by_fixed,
        "by_period": by_period,
        "income_details": income_details,
        "expense_details": expense_details,
    }


@app.get("/analyses/meta")
async def get_analyses_meta(
    branch: str,
    authorization: Optional[str] = Header(None)
):
    """
    GET /analyses/meta?branch=동탄역점
    👉 해당 유저 + 지점의 메타데이터 불러오기
    """
    user_id = await get_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # ✅ Supabase 요청
        res = (
            supabase.table("analyses_meta")
            .select("*")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .maybe_single()
            .execute()
        )

        # ✅ 안전 처리: None 방지
        data = getattr(res, "data", None)

        if data:
            # ✅ 정상적으로 데이터가 존재할 경우 그대로 반환
            return data
        else:
            # ✅ 데이터가 없을 경우 기본 구조 반환
            return {"designers": [], "interns": 0, "visitors_total": 0}

    except Exception as e:
        # ✅ 에러 발생 시에도 안전하게 기본값 반환
        print("[❌ get_analyses_meta 오류 발생]", e)
        return {"designers": [], "interns": 0, "visitors_total": 0}


@app.post("/analyses/meta")
async def save_analyses_meta(
    payload: dict,
    authorization: Optional[str] = Header(None)
):
    """
    POST /analyses/meta
    {
        "branch": "동탄역점",
        "designers": ["김실장","박디자이너"],
        "interns": 2,
        "visitors_total": 480
    }
    """
    user_id = await get_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    branch = payload.get("branch")
    if not branch:
        raise HTTPException(status_code=400, detail="branch is required")

    data = {
        "user_id": user_id,
        "branch": branch,
        "designers": payload.get("designers", []),
        "interns": payload.get("interns", 0),
        "visitors_total": payload.get("visitors_total", 0),
        "updated_at": datetime.now(timezone.utc)
    }

    res = (
        supabase.table("analyses_meta")
        .upsert(data, on_conflict="user_id,branch")
        .execute()
    )

    if res.error:
        raise HTTPException(status_code=500, detail=f"DB 저장 실패: {res.error}")
    return {"status": "ok", "saved": data}

@app.post("/transactions/summary")
async def transaction_summary(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    """
    선택된 지점(branch)과 기간(start_month~end_month)을 기준으로
    월별 고정/변동지출 + 사업자배당 합계를 반환합니다.
    """
    user_id = await get_user_id(authorization)
    branch = body.get("branch")
    start = body.get("start_month")
    end = body.get("end_month")

    if not all([branch, start, end]):
        raise HTTPException(status_code=400, detail="branch, start_month, end_month 필수")

    try:
        res = (
            supabase.table("transactions")
            .select("tx_date, category, amount, is_fixed")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("tx_date", f"{start}-01")
            .lte("tx_date", pd.Period(end).end_time.strftime("%Y-%m-%d"))
            .execute()
        )
        rows = res.data or []
        if not rows:
            return []

        df = pd.DataFrame(rows)
        df["month"] = pd.to_datetime(df["tx_date"]).dt.strftime("%Y-%m")
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)

        # ✅ 고정/변동 지출 계산
        monthly_summary = (
            df.groupby(["month"])
            .apply(lambda x: pd.Series({
                "fixed_expense": abs(x.loc[(x["is_fixed"] == True) & (x["category"] != "사업자배당"), "amount"].clip(upper=0).sum()),
                "variable_expense": abs(x.loc[(x["is_fixed"] == False) & (x["category"] != "사업자배당"), "amount"].clip(upper=0).sum()),
                # ✅ 사업자배당 추가
                "owner_dividend": abs(x.loc[x["category"] == "사업자배당", "amount"].clip(upper=0).sum()),
            }))
            .reset_index()
        )

        return monthly_summary.to_dict(orient="records")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"summary 계산 실패: {e}")

@app.get("/meta/designers")
async def get_designers(
    branch: str = Query(...),
    authorization: Optional[str] = Header(None)
):
    """
    특정 지점의 디자이너 목록 반환
    """
    user_id = await get_user_id(authorization)

    res = (
        supabase.table("designer_meta")
        .select("name, rank")
        .eq("user_id", user_id)
        .eq("branch", branch)
        .execute()
    )

    designers = [{"name": r["name"], "rank": r["rank"]} for r in res.data]
    return {"designers": designers}


@app.post("/meta/designers")
async def save_designers(
    payload: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    """
    지점별 디자이너 목록 저장 (전체 교체)
    {
      "branch": "동탄역점",
      "designers": [{ "name": "홍길동", "rank": "실장" }, ...]
    }
    """
    user_id = await get_user_id(authorization)
    branch = payload.get("branch")
    designers = payload.get("designers", [])

    if not branch:
        raise HTTPException(status_code=400, detail="branch is required")

    # 기존 데이터 삭제
    supabase.table("designer_meta").delete().eq("user_id", user_id).eq("branch", branch).execute()

    # 새 데이터 삽입
    if designers:
        rows = [
            {
                "user_id": user_id,
                "branch": branch,
                "name": d["name"],
                "rank": d.get("rank", "디자이너")
            }
            for d in designers
        ]
        supabase.table("designer_meta").insert(rows).execute()

    return {"ok": True, "count": len(designers)}


# @app.get("/transactions/salary_candidates")
# async def get_salary_candidates(
#     branch: str,
#     start_month: str,
#     end_month: str,
#     authorization: Optional[str] = Header(None)
# ):
#     """
#     엑셀 기반 거래내역 중 지출(amount < 0)이며
#     description 또는 memo에 디자이너 이름이 포함된 항목 자동 탐색
#     """
#     user_id = await get_user_id(authorization)

#     # 디자이너 목록 불러오기
#     res_designers = (
#         supabase.table("designer_meta")
#         .select("name")
#         .eq("user_id", user_id)
#         .eq("branch", branch)
#         .execute()
#     )
#     names = [r["name"] for r in res_designers.data]
#     if not names:
#         return []

#     # 날짜 범위 계산
#     start_date = f"{start_month}-01"
#     end_date = f"{end_month}-31"

#     # 거래내역 불러오기
#     txs = (
#         supabase.table("assets_log")
#         .select("id, created_at, description, memo, amount, branch")
#         .eq("user_id", user_id)
#         .eq("branch", branch)
#         .lt("amount", 0)  # 지출만
#         .gte("created_at", start_date)
#         .lte("created_at", end_date)
#         .execute()
#         .data
#         or []
#     )

#     results = []
#     for tx in txs:
#         text = (tx.get("description") or "") + " " + (tx.get("memo") or "")
#         for n in names:
#             if n and n in text:
#                 results.append({
#                     "tx_id": tx["id"],
#                     "tx_date": tx["created_at"][:10],
#                     "description": tx["description"] or tx["memo"] or "",
#                     "amount": tx["amount"],
#                     "matched_designer": n,
#                     "branch": tx.get("branch")
#                 })
#                 break
#     return results


# @app.post("/transactions/salary_confirm")
# async def save_salary_confirm(
#     payload: dict = Body(...),
#     authorization: Optional[str] = Header(None)
# ):
#     """
#     선택된 항목을 급여로 확정 저장
#     {
#       "branch": "동탄역점",
#       "month_range": { "start": "2025-09", "end": "2025-09" },
#       "items": [{ "tx_id": "uuid", "name": "홍길동", "amount": 3500000, "tx_date": "2025-09-28", "description": "급여" }]
#     }
#     """
#     user_id = await get_user_id(authorization)
#     branch = payload.get("branch")
#     items = payload.get("items", [])

#     if not branch or not items:
#         raise HTTPException(status_code=400, detail="branch/items required")

#     # 디자이너 직급 맵 가져오기
#     meta = (
#         supabase.table("designer_meta")
#         .select("name, rank")
#         .eq("user_id", user_id)
#         .eq("branch", branch)
#         .execute()
#     )
#     rank_map = {r["name"]: r["rank"] for r in meta.data}

#     rows = []
#     for it in items:
#         month = it["tx_date"][:7]
#         rows.append({
#             "user_id": user_id,
#             "branch": branch,
#             "name": it["name"],
#             "rank": rank_map.get(it["name"], "디자이너"),
#             "month": month,
#             "amount": it["amount"],
#             "tx_ids": [it["tx_id"]],
#         })

#     supabase.table("designer_salaries").insert(rows).execute()
#     return {"ok": True, "count": len(rows)}


# @app.get("/transactions/salary_list")
# async def get_salary_list(
#     branch: str,
#     month: str,
#     authorization: Optional[str] = Header(None)
# ):
#     """
#     특정 지점/월의 확정된 급여 내역 조회
#     """
#     user_id = await get_user_id(authorization)
#     res = (
#         supabase.table("designer_salaries")
#         .select("name, rank, month, amount")
#         .eq("user_id", user_id)
#         .eq("branch", branch)
#         .eq("month", month)
#         .execute()
#     )
#     return res.data

# # === 디자이너 월급 조회 (지점 + 월 범위) ===
# @app.get("/designer_salaries/range")
# async def get_designer_salaries_range(
#     branch: str,
#     start_month: str,
#     end_month: str,
#     authorization: Optional[str] = Header(None)
# ):
#     """
#     GET /designer_salaries/range?branch=동탄역점&start_month=2025-08&end_month=2025-09
#     👉 지정된 지점의 특정 기간(월 단위) 디자이너 급여 목록을 반환
#     """
#     user_id = await get_user_id(authorization)

#     try:
#         data = (
#             supabase.table("designer_salaries")
#             .select("name, rank, month, amount")
#             .eq("user_id", user_id)
#             .eq("branch", branch)
#             .gte("month", start_month)
#             .lte("month", end_month)
#             .order("month", desc=True)
#             .execute()
#             .data
#         ) or []
#     except Exception as e:
#         print(f"⚠️ get_designer_salaries_range 오류: {e}")
#         data = []

#     return data

@app.post("/salon/monthly-data")
async def get_monthly_data(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    특정 지점(branch), 기간(start_month~end_month)의 salon_monthly_data 조회
    """
    user_id = await get_user_id(authorization)
    branch = body.get("branch")
    start_month = body.get("start_month")
    end_month = body.get("end_month")

    if not branch or not start_month or not end_month:
        raise HTTPException(status_code=400, detail="branch, start_month, end_month 필수")

    try:
        res = (
            supabase.table("salon_monthly_data")
            .select("*")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("month", start_month)
            .lte("month", end_month)
            .order("month", desc=False)
            .execute()
        )
        data = sorted(res.data or [], key=lambda x: x["month"])

        print(f"✅ [salon_monthly_data] {branch} {start_month}~{end_month} ({len(data)}건)")
        return {"months": data}

    except Exception as e:
        print("❌ salon_monthly_data 조회 오류:", e)
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")
    
@app.post("/salon/input-sales")
async def get_input_sales(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    ✅ 지점(branch)과 기간(start_month~end_month)을 기준으로
    사용자가 직접 입력한 '실제 매출'(카드/페이)을 반환합니다.
    (테이블: salon_input_sales)
    """
    user_id = await get_user_id(authorization)
    branch = body.get("branch")
    start_month = body.get("start_month")
    end_month = body.get("end_month")

    if not all([branch, start_month, end_month]):
        raise HTTPException(status_code=400, detail="branch, start_month, end_month 필수")

    try:
        res = (
            supabase.table("salon_input_sales")
            .select("month, card_sales, pay_sales")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("month", start_month)
            .lte("month", end_month)
            .order("month", desc=False)
            .execute()
        )
        data = res.data or []

        print(f"✅ [salon_input_sales] {branch} {start_month}~{end_month} ({len(data)}건)")
        return data

    except Exception as e:
        print(f"❌ salon_input_sales 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

# === 최신 통장 잔액 조회 ===
@app.post("/transactions/latest-balance")
async def get_latest_balance(body: dict = Body(...), authorization: Optional[str] = Header(None)):
    """
    선택된 지점(branch)과 종료월(end_month)을 기준으로,
    transactions 테이블에서 가장 최근의 balance(잔액)를 반환한다.
    """
    branch = body.get("branch")
    end_month = body.get("end_month")

    if not branch or not end_month:
        raise HTTPException(status_code=400, detail="branch, end_month는 필수입니다.")

    user_id = await get_user_id(authorization)

    # 종료월의 마지막 날짜 구하기
    end_date = pd.Period(end_month).end_time.strftime("%Y-%m-%d")

    try:
        # ✅ 컬럼명: tx_date 사용 (당신의 DB 구조에 맞춤)
        res = (
            supabase.table("transactions")
            .select("balance, tx_date")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .lte("tx_date", end_date)
            .order("tx_date", desc=True)
            .limit(1)
            .execute()
        )

        if res.data and len(res.data) > 0:
            balance = res.data[0].get("balance", 0)
            tx_date = res.data[0].get("tx_date", "")
            return {"balance": balance, "date": tx_date}
        else:
            return {"balance": 0, "message": "해당 기간 잔액 데이터 없음"}

    except Exception as e:
        print("⚠️ 통장 잔액 조회 실패:", e)
        raise HTTPException(status_code=500, detail=str(e))
    
# === 💇‍♀️ 재무건전성 진단 (A~E) — 기간 집계 + 월별 계산 + GPT 서식 출력 ===
@app.post("/gpt/financial-diagnosis")
async def financial_diagnosis(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    입력: { "branch": "동탄역점", "start_month": "YYYY-MM", "end_month": "YYYY-MM" }
    로직:
      1) salon_monthly_data: 매출/고객/정액권, 근무일수 등
      2) transactions: 카테고리별 비용(고정/변동), 마케팅, 세금, 사업자배당
      3) designer_salaries: 인건비
      4) assets_log: 유동/부동 자산(보증금, 사업자통장 잔액 자동등록 로그)
      5) 월별 지표 → 평가(좋음/보통/위험) → 점수화 → 등급(A~E)
      6) GPT에 표/수치 던져서 “진단표” 작성
    """
    if not openai_client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY 미설정")

    # --- 입력/유저
    user_id = await get_user_id(authorization)
    branch = (body.get("branch") or "").strip()
    start_month = body.get("start_month")
    end_month = body.get("end_month")
    if not all([branch, start_month, end_month]):
        raise HTTPException(status_code=400, detail="branch, start_month, end_month 필수")

    print(f"🔎 [financial-diagnosis] {branch} {start_month}~{end_month}")

    # 유틸
    def month_last_day(ym: str) -> str:
        y, m = map(int, ym.split("-"))
        last = monthrange(y, m)[1]
        return f"{ym}-{last:02d}"

    # ===== 1) 월별 기본(매출/고객/정액권/근무일수) =====
    mres = (
        supabase.table("salon_monthly_data")
        .select("month, card_sales, pay_sales, cash_sales, account_sales, visitors, returning_visitors, pass_paid, pass_used, pass_balance")
        .eq("user_id", user_id)
        .eq("branch", branch)
        .gte("month", start_month)
        .lte("month", end_month)
        .order("month", desc=False)
        .execute()
    )
    mrows = mres.data or []
    if not mrows:
        raise HTTPException(status_code=404, detail="선택 기간의 salon_monthly_data 없음")

    # YYYY-MM -> 정렬 보장
    months = sorted([r["month"] for r in mrows])

    # 빠른 참조용 dict
    md = {r["month"]: r for r in mrows}

    # ===== 2) 비용/수익 트랜잭션 집계 =====
    #  (우리는 카테고리 이름을 정확히 사용: 스크린샷 기준)
    date_from = f"{start_month}-01"
    date_to = month_last_day(end_month)

    tres = (
        supabase.table("transactions")
        .select("tx_date, category, amount, is_fixed")
        .eq("user_id", user_id)
        .eq("branch", branch)
        .gte("tx_date", date_from)
        .lte("tx_date", date_to)
        .execute()
    )
    tx = tres.data or []
    tx_df = pd.DataFrame(tx) if tx else pd.DataFrame(columns=["tx_date","category","amount","is_fixed"])
    if not tx_df.empty:
        tx_df["tx_date"] = pd.to_datetime(tx_df["tx_date"], errors="coerce")
        tx_df["month"] = tx_df["tx_date"].dt.strftime("%Y-%m")
        tx_df["amount"] = pd.to_numeric(tx_df["amount"], errors="coerce").fillna(0.0)
        tx_df["category"] = tx_df["category"].fillna("")
        tx_df["is_fixed"] = tx_df.get("is_fixed", False).fillna(False)
    else:
        tx_df["month"] = []

    # ---- 카테고리 매핑(필요치만 정확히 집계) ----
    FIXED_SET = set(["월세","렌탈료","관리비","통신료","청소업체","핸드비용"])
    # 인건비는 별도로 designer_salaries + 일부 트랜잭션 카테고리 포함
    LABOR_TX_SET = set(["디자이너월급","인턴월급","바이저월급","직원지원비","4대보험"])
    MATERIAL_CAT = "헤어재료비"
    MARKETING_CAT = "마케팅비"
    TAX_CAT = "세금"
    OWNER_DIVIDEND = "사업자배당"

    # 월별 합계용 도우미
    def sum_tx(month, cond):
        if tx_df.empty:
            return 0.0
        sub = tx_df[tx_df["month"].eq(month)]
        if sub.empty:
            return 0.0
        sub = sub[cond(sub)]
        # ✅ 모든 지출을 절대값 기준으로 계산
        return float(sub["amount"].abs().sum())

    # ===== 3) 인건비(디자이너 급여) =====
    sres = (
        supabase.table("designer_salaries")
        .select("month, total_amount")
        .eq("user_id", user_id)
        .eq("branch", branch)
        .gte("month", start_month)
        .lte("month", end_month)
        .execute()
    )
    sal = sres.data or []
    sdf = pd.DataFrame(sal) if sal else pd.DataFrame(columns=["month","total_amount"])
    if not sdf.empty:
        sdf["total_amount"] = pd.to_numeric(sdf["total_amount"], errors="coerce").fillna(0.0)

    def labor_amount(month: str) -> float:
        # designer_salaries
        a = 0.0
        if not sdf.empty:
            a += float(sdf.loc[sdf["month"].eq(month), "total_amount"].sum())
        # 트랜잭션 쪽(급여 관련 카테고리) — 음수로 들어갔다면 합계는 음수.
        b = sum_tx(month, lambda t: t["category"].isin(list(LABOR_TX_SET)))
        return float(a + b)

    # ===== 4) 자산(현금·예금 / 부동자산) =====
    # - 자동등록된 ‘월말 잔액’ 로그가 있으면 그걸 스냅샷으로 사용
    # - 없으면 transactions 최신 balance로 대체하는 함수 재사용
    def latest_bank_balance(end_ym: str) -> Optional[float]:
        try:
            # assets_log에서 "잔액 기준 자동등록" 최신 1건
            a = (
                supabase.table("assets_log")
                .select("amount, created_at, memo, category")
                .eq("user_id", user_id)
                .eq("branch", branch)
                .ilike("memo", "%잔액 기준 자동등록%")
                .lte("created_at", month_last_day(end_ym))
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            ).data or []
            if a:
                return float(a[0].get("amount") or 0.0)
        except Exception as e:
            print("⚠️ assets_log 잔액 조회 실패:", e)
        # fallback: transactions 최신 balance
        try:
            res = (
                supabase.table("transactions")
                .select("balance, tx_date")
                .eq("user_id", user_id)
                .eq("branch", branch)
                .lte("tx_date", month_last_day(end_ym))
                .order("tx_date", desc=True)
                .limit(1)
                .execute()
            ).data or []
            if res:
                return float(res[0].get("balance") or 0.0)
        except Exception as e:
            print("⚠️ transactions 최신 balance 조회 실패:", e)
        return None

    def latest_fixed_deposit(end_ym: str) -> Optional[float]:
        # 보증금(부동자산) 최근 금액(사용자가 자산 로그로 기록했다고 가정)
        try:
            res = (
                supabase.table("assets_log")
                .select("amount, created_at, category, memo")
                .eq("user_id", user_id)
                .eq("branch", branch)
                .ilike("category", "%보증금%")
                .lte("created_at", month_last_day(end_ym))
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            ).data or []
            if res:
                return float(res[0].get("amount") or 0.0)
        except Exception as e:
            print("⚠️ 보증금 조회 실패:", e)
        return None

    # ===== 5) 월별 계산 =====
    results = []
    for ym in months:
        base = md.get(ym, {})
        card = float(base.get("card_sales", 0) or 0)
        pay = float(base.get("pay_sales", 0) or 0)
        cash = float(base.get("cash_sales", 0) or 0)
        acct = float(base.get("account_sales", 0) or 0)
        monthly_sales = card + pay + cash + acct

        visitors = int(base.get("visitors", 0) or 0)
        returning = int(base.get("returning_visitors", 0) or 0)
        pass_paid = float(base.get("pass_paid", 0) or 0)
        pass_used = float(base.get("pass_used", 0) or 0)
        pass_bal = float(base.get("pass_balance", pass_paid - pass_used) or (pass_paid - pass_used))
        work_days = int(base.get("work_days", 0) or 0)

        # 수정 (✅ 인건비 분리)
        fixed_other = sum_tx(ym, lambda t: t["category"].isin(list(FIXED_SET)))
        labor = 0.0
        if not sdf.empty:
            labor = float(sdf.loc[sdf["month"].eq(ym), "total_amount"].sum())
        # designer_salaries만 사용 (transactions 급여 카테고리는 제외)
        fixed_total = float(fixed_other)   # ✅ 인건비 제외

        # 재료비/마케팅/세금/사업자배당
        materials = sum_tx(ym, lambda df: df["category"] == MATERIAL_CAT)
        marketing = sum_tx(ym, lambda df: df["category"] == MARKETING_CAT)
        tax_amt   = sum_tx(ym, lambda df: df["category"] == TAX_CAT)
        owner_div = sum_tx(ym, lambda df: df["category"] == OWNER_DIVIDEND)
        
        # 비율 계산 (0 division 방지)
        def pct(a, b):
            return float(a / b * 100.0) if b and b != 0 else None

        unit_sales = float(monthly_sales / visitors) if visitors else None
        revisit_rate = pct(returning, visitors)
        pass_ratio = pct(pass_paid, monthly_sales)

        fixed_ratio = pct(abs(fixed_total), monthly_sales)
        labor_ratio = pct(abs(labor), monthly_sales)
        material_ratio = pct(abs(materials), monthly_sales)
        mkt_ratio = pct(abs(marketing), monthly_sales)

        print(f"[DEBUG] {ym} 재료비 합계={materials:,} / 비율={material_ratio}")

        # ✅ 영업이익 (사업자배당 제외)
        op_profit_est = monthly_sales - (
            abs(fixed_other) + abs(labor) + abs(materials) + abs(marketing) + abs(tax_amt)
        )

        # ✅ 순이익 (사업자배당 포함)
        net_profit_est = monthly_sales - (
            abs(fixed_other) + abs(labor) + abs(materials) + abs(marketing) + abs(tax_amt) + abs(owner_div)
        )

        # ✅ 비율 계산
        op_margin_est = pct(op_profit_est, monthly_sales)
        net_margin_est = pct(net_profit_est, monthly_sales)
        # 현금/자산/부채 스냅샷(기간의 마지막 달 기준에서만 의미있음)
        # 월별 결과에도 같이 넣어두고, 최종 요약은 end_month로 산출
        cash_hold = latest_bank_balance(ym)
        fixed_deposit = latest_fixed_deposit(ym)
        total_assets = None
        if cash_hold is not None and fixed_deposit is not None:
            total_assets = cash_hold + fixed_deposit
        elif cash_hold is not None:
            total_assets = cash_hold

        total_debt = pass_bal  # 부채 = 정액권 잔액

        # 평가(좋음/보통/위험)
        def eval3(val, rule):
            if val is None:
                return "데이터 부족"
            lo = rule["lo"]; mid = rule["mid"]; hi = rule["hi"]; mode = rule["mode"]
            # mode: 'higher_better' or 'range' or 'lower_better'
            if mode == "higher_better":
                return "좋음" if val >= hi else ("보통" if val >= mid else "위험")
            if mode == "lower_better":
                return "좋음" if val <= lo else ("보통" if val <= mid else "위험")
            # range
            return "좋음" if (lo <= val <= hi) else ("보통" if (min(lo,hi) - 10 <= val <= max(lo,hi) + 10) else "위험")  # 범용

        # 기준표 매핑
        eval_map = {
            "재방문율":     lambda: eval3(revisit_rate, dict(lo=70, mid=50, hi=70, mode="higher_better")),
            "정액권비중":   lambda: ("좋음" if pass_ratio is not None and 20 <= pass_ratio <= 30 else ("보통" if pass_ratio is not None and 30 < pass_ratio <= 40 else ("위험" if pass_ratio is not None and pass_ratio > 40 else "데이터 부족"))),
            "고정비비율":   lambda: eval3(fixed_ratio, dict(lo=60, mid=75, hi=60, mode="lower_better")),
            "인건비비율":   lambda: ("좋음" if labor_ratio is not None and 35 <= labor_ratio <= 45 else ("보통" if labor_ratio is not None and 45 < labor_ratio < 50 else ("위험" if labor_ratio is not None and labor_ratio >= 50 else "데이터 부족"))),
            "재료비비율": lambda: (
                    "좋음" if material_ratio is not None and 10 <= material_ratio <= 15 else
                    ("보통" if material_ratio is not None and 15 < material_ratio < 20 else
                    ("위험" if material_ratio is not None and material_ratio >= 20 else
                    ("위험" if material_ratio is not None else "데이터 부족")))
                ),
            "영업이익률":   lambda: ("좋음" if op_margin_est is not None and op_margin_est >= 10 else ("보통" if op_margin_est is not None and 5 <= op_margin_est < 10 else ("위험" if op_margin_est is not None and op_margin_est < 5 else "데이터 부족"))),
            "고객회전율":   lambda: ("좋음" if (visitors and work_days and visitors/work_days >= 8) else ("보통" if (visitors and work_days and 5 <= visitors/work_days < 8) else ("위험" if (visitors and work_days and visitors/work_days < 5) else "데이터 부족"))),
        }

        # 점수화(좋음2/보통1/위험0/부족=무시)
        def score(x):
            return {"좋음":2,"보통":1,"위험":0}.get(x, None)

        evals = {k: f() for k, f in eval_map.items()}
        scores = [s for s in map(score, evals.values()) if s is not None]
        avg_score = float(np.mean(scores)) if scores else 0.0
        # 등급(ⅠⅧ 점수화 로직)
        if   avg_score >= 1.8: grade = "A"
        elif avg_score >= 1.4: grade = "B"
        elif avg_score >= 1.0: grade = "C"
        elif avg_score >= 0.6: grade = "D"
        else:                  grade = "E"

        results.append(dict(
                month=ym,
                monthly_sales=monthly_sales,
                visitors=visitors,
                returning_visitors=returning,
                unit_sales=unit_sales,
                revisit_rate=revisit_rate,

                # 💳 정액권 관련
                pass_paid=pass_paid,
                pass_used=pass_used,
                pass_balance=pass_bal,
                pass_ratio=pass_ratio,

                # 💸 비용 구조
                fixed_other=fixed_other,
                labor=labor,
                fixed_total=fixed_total,
                material=materials,
                marketing=marketing,
                tax=tax_amt,
                owner_dividend=owner_div,

                # 📊 비율 구조
                fixed_ratio=fixed_ratio,
                labor_ratio=labor_ratio,
                material_ratio=material_ratio,
                mkt_ratio=mkt_ratio,

                # 💰 이익 계산 (신규 추가)
                op_profit_est=op_profit_est,      # 영업이익
                op_margin_est=op_margin_est,      # 영업이익률
                net_profit_est=net_profit_est,    # 순이익 (사업자배당 포함)
                net_margin_est=net_margin_est,    # 순이익률 (사업자배당 포함)

                # 📅 운영 정보
                work_days=work_days,

                # 🏦 자산·부채
                cash_hold=cash_hold,
                fixed_deposit=fixed_deposit,
                total_assets=total_assets,
                total_debt=total_debt,

                # 🧮 평가
                evals=evals,
                avg_score=avg_score,
                grade=grade
            ))

    # ===== 6) 최종 요약(기간 마지막 달 기준의 현금/자산/부채/현금유보/부채비율) =====
    last = results[-1]
    # 3개월 필요현금 = 고정비(마지막달) × 3
    need_3m_cash = abs(last["fixed_total"]) * 3.0
    cash_buffer_ratio = float((last["cash_hold"] / need_3m_cash * 100.0)) if (last["cash_hold"] is not None and need_3m_cash) else None
    debt_ratio = float((last["total_debt"] / last["total_assets"] * 100.0)) if (last["total_assets"] not in [None,0] and last["total_debt"] is not None) else None

    # 현금유보/부채 평가
    def eval_cash(x):
        if x is None: return "데이터 부족"
        return "좋음" if x >= 100 else ("보통" if 50 <= x < 100 else "위험")
    def eval_debt(x):
        if x is None: return "데이터 부족"
        return "좋음" if x < 100 else ("보통" if 100 <= x < 200 else "위험")

    cash_eval = eval_cash(cash_buffer_ratio)
    debt_eval = eval_debt(debt_ratio)

    # ===== 7) GPT 프롬프트 생성 (요구된 ‘표 형식’ 그대로) =====
    # 테이블 본문(한 달씩 라인 만들기 위해 필요한 핵심 지표만)
    def fmt_money(x): 
        return f"₩{x:,.0f}" if x is not None else "데이터 부족"
    def fmt_pct(x):
        return f"{x:.1f}%" if x is not None else "데이터 부족"
    def fmt_int(x):
        return f"{int(x)}" if x is not None else "데이터 부족"

    # 핵심 지표 행들(마지막 달 기준 필수 포함)
    table_lines = []
    for r in results:
        # 구분: 매출 구조 / 비용 구조 / 현금·부채 / 수익성 / 운영 효율
        table_lines += [
            f"| 매출 구조 | 객단가 | {fmt_money(r['unit_sales'])} | - | {r['evals']['영업이익률'] if r['unit_sales'] is not None else '데이터 부족'} |",
            f"| 매출 구조 | 재방문율 | {fmt_pct(r['revisit_rate'])} | ≥70% | {r['evals']['재방문율']} |",
            f"| 매출 구조 | 정액권 매출비중 | {fmt_pct(r['pass_ratio'])} | 20~30% | {r['evals']['정액권비중']} |",
            f"| 비용 구조 | 고정비 비율 | {fmt_pct(r['fixed_ratio'])} | ≤60% | {r['evals']['고정비비율']} |",
            f"| 비용 구조 | 인건비 비율 | {fmt_pct(r['labor_ratio'])} | 35~45% | {r['evals']['인건비비율']} |",
            f"| 비용 구조 | 재료비 비율 | {fmt_pct(r['material_ratio'])} | 10~15% | {r['evals']['재료비비율']} |",
            f"| 수익성 | 영업이익률(추정) | {fmt_pct(r['op_margin_est'])} | ≥10% | {r['evals']['영업이익률']} |",
            f"| 운영 효율 | 고객 회전율 | {fmt_int(r['visitors']/r['work_days'] if r['work_days'] else None)}명/일 | ≥8명/일 | {r['evals']['고객회전율']} |",
        ]
        table_lines.append("|---|---|---|---|---|")  # 월 구분선 느낌 (시각 구분)

    # 한줄 요약 텍스트 후보(마지막달 기준)
    one_liner = (
        "고정비와 인건비, 재료비, 마케팅비를 반영한 추정 영업이익률이 "
        + (fmt_pct(last['op_margin_est']))
        + " 수준입니다. "
        + f"현금유보비율 {fmt_pct(cash_buffer_ratio)}, 부채비율 {fmt_pct(debt_ratio)}."
    )

    # 최종 등급은 기간 평균점수로 산출
    avg_all = float(np.mean([r["avg_score"] for r in results])) if results else 0.0
    if   avg_all >= 1.8: final_grade = "A"
    elif avg_all >= 1.4: final_grade = "B"
    elif avg_all >= 1.0: final_grade = "C"
    elif avg_all >= 0.6: final_grade = "D"
    else:                final_grade = "E"

    # GPT에 전달할 “요약 수치 + 표”
    gpt_prompt = f"""
당신은 미용실 재무건전성 진단 전문가다.
다음 데이터를 기반으로, 요구된 출력 형식에 맞춰 간결하고 직설적으로 작성하라.

[기본정보]
지점명: {branch}
기간: {start_month} ~ {end_month}

[핵심 요약 수치 (마지막 달 기준)]
월매출: {fmt_money(last['monthly_sales'])}
총객수: {fmt_int(last['visitors'])}명 / 재방문: {fmt_int(last['returning_visitors'])}명
객단가: {fmt_money(last['unit_sales'])}
정액권 결제액/차감액/잔액(부채): {fmt_money(last['pass_paid'])} / {fmt_money(last['pass_used'])} / {fmt_money(last['pass_balance'])}
고정비(인건비 포함): {fmt_money(abs(last['fixed_total']))} (인건비 {fmt_money(abs(last['labor']))})
재료비: {fmt_money(abs(last['material']))} / 마케팅비: {fmt_money(abs(last['marketing']))}
영업이익(추정): {fmt_money(last['op_profit_est'])} / 영업이익률(추정): {fmt_pct(last['op_margin_est'])}
보유현금·예금(추정): {fmt_money(last['cash_hold'])}
총자산(추정): {fmt_money(last['total_assets'])} / 총부채(정액권잔액): {fmt_money(last['total_debt'])}
3개월 필요 현금: {fmt_money(need_3m_cash)}
현금유보비율: {fmt_pct(cash_buffer_ratio)} ({cash_eval})
부채비율: {fmt_pct(debt_ratio)} ({debt_eval})

[표 — 구분/항목/수치/기준/평가]
| 구분 | 항목 | 수치 | 기준/권장범위 | 평가(좋음/보통/위험) |
|---|---|---|---|---|
{chr(10).join(table_lines)}

[평가 기준]
- 재방문율: 70% 이상 좋음 / 50~70% 보통 / 50% 미만 위험
- 정액권 매출비중: 20~30% 적정 / 40% 이상 과다
- 고정비 비율: 60% 이하 좋음 / 60~75% 보통 / 75% 이상 위험
- 재료비 비율: 10~15% 권장 / 20% 이상 원가관리 필요
- 인건비 비율: 35~45% 적정 / 50% 이상 과다
- 현금유보비율: 100% 이상 안전 / 50~100% 보통 / 50% 미만 위험
- 부채비율: 100% 미만 안정 / 100~200% 주의 / 200% 이상 고위험
- 영업이익률: 10% 이상 좋음 / 5~10% 보통 / 5% 미만 위험
- 고객 회전율: 8명/일 이상 안정 / 5~8명/일 보통 / 5명/일 미만 위험

[출력 형식]
1. 한줄 요약
2. 핵심 지표 테이블 (위 표 그대로)
3. 재무건전성 등급
   - 등급: A/B/C/D/E 중 하나 (기간 평균점수 기반, 현재 계산값: {final_grade})
   - 이유: 2~3줄로 숫자 포함
4. 개선 액션 제안 (최대 5개, 한 줄씩. 무엇을/얼마나/언제까지)

한줄 요약으로는 다음 문장을 참고하되 과장 없이 간단히 정리하라:
- "{one_liner}"
"""

    try:
        gpt = openai_client.chat.completions.create(
            model="gpt-4o",
            temperature=0.2,
            max_tokens=2200,
            messages=[
                {"role": "system", "content": "너는 미용실 재무건전성 진단 전문가다. 수치 기반으로 간결하고 직설적으로 작성하라. 데이터 부족은 명확히 표시하라."},
                {"role": "user", "content": gpt_prompt},
            ],
            timeout=120,
        )
        analysis_text = gpt.choices[0].message.content
    except Exception as e:
        print("⚠️ GPT 실패:", e)
        analysis_text = "[알림] GPT 출력 생성에 실패했습니다. 계산 결과(JSON)를 참고하세요."

    # ✅ GPT 분석 결과 저장 (analyses 테이블)
    try:
        record = {
            "user_id": user_id,
            "branch": branch,
            "title": f"{branch} 재무건전성 진단 ({start_month}~{end_month})",
            "content": str(analysis_text)[:1000],  # 너무 길면 자르기
            "grade": final_grade,
            "cash_buffer_ratio": cash_buffer_ratio,
            "debt_ratio": debt_ratio,
            "period_start": start_month,
            "period_end": end_month,
            "created_at": datetime.utcnow().isoformat(),  # ✅ isoformat으로 변경
        }

        res = supabase.table("analyses").insert(record).execute()
        print("🧾 [analyses insert 결과] =", res)
    except Exception as e:
        import traceback
        print("⚠️ analyses 저장 실패:", e)
        traceback.print_exc()

    return {
        "branch": branch,
        "period": f"{start_month}~{end_month}",
        "grade": final_grade,
        "cash_buffer_ratio": cash_buffer_ratio,
        "debt_ratio": debt_ratio,
        "need_3m_cash": need_3m_cash,
        "months": results,           # 월별 상세 지표
        "analysis": analysis_text,   # GPT 진단표
    }


# ✅ 사업자 유입총액 계산 API (내수금, 기타수입 제외)
@app.post('/transactions/income-filtered')
async def income_filtered(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    """
    선택된 지점(branch), 시작월(start_month), 종료월(end_month)을 기준으로
    'transactions' 테이블에서 수입(+) 중
    '내수금', '기타수입' 카테고리를 제외한 금액의 합계를 계산.
    """
    user_id = await get_user_id(authorization)
    branch = body.get("branch")
    start_month = body.get("start_month")
    end_month = body.get("end_month")

    if not all([branch, start_month, end_month]):
        raise HTTPException(status_code=400, detail="branch, start_month, end_month 필수")

    try:
        # ✅ 종료월의 마지막 날짜 계산 (유효한 날짜로)
        y, m = map(int, end_month.split('-'))
        last_day = monthrange(y, m)[1]  # 예: 2025-09 -> 30
        end_date = f"{end_month}-{last_day:02d}"

        # ✅ Supabase 조회
        res = (
            supabase.table("transactions")
            .select("amount, category, tx_date")
            .eq("user_id", user_id)
            .eq("branch", branch)
            .gte("tx_date", f"{start_month}-01")
            .lte("tx_date", end_date)
            .execute()
        )

        rows = res.data or []
        print(f"📦 [income-filtered] {branch} {start_month}~{end_month} ({len(rows)}건 조회)")

        if not rows:
            return {"bank_inflow": 0}

        # ✅ 수입(+) 중 '내수금', '기타수입' 제외
        filtered = []
        for r in rows:
            try:
                amount = float(r.get("amount", 0) or 0)
                category = str(r.get("category") or "")
                if amount > 0 and not any(ex in category for ex in ["내수금", "기타수입"]):
                    filtered.append(amount)
            except Exception as e:
                print("⚠️ 금액 변환 오류:", r, e)
                continue

        bank_inflow = sum(filtered)
        print(f"✅ [income-filtered] 계산결과: {bank_inflow:,}원 (내수금/기타수입 제외됨)")

        return {"bank_inflow": bank_inflow}



    except Exception as e:
        import traceback
        print("❌ income-filtered 오류:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"income-filtered 내부 오류: {e}")
    

@app.get("/analyses")
async def list_analyses(authorization: Optional[str] = Header(None)):
    """
    🔹 admin / viewer 구분 없이 전체 GPT 분석 리포트 조회 가능
    """
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)

    try:
        q = (
            supabase.table("analyses")
            .select("id, user_id, branch, title, created_at")  # ✅ user_id 포함
            .order("created_at", desc=True)
        )

        # 🔸 과거에는 .eq("user_id", user_id) 로 제한했지만
        #     지금은 역할 무관 전체 접근 허용
        #     (필요 시 admin만 전체 조회로 변경 가능)

        res = q.execute()
        items = res.data or []

        # 🔹 viewer도 볼 수 있게 필터링 제거 완료
        return {"items": items}

    except Exception as e:
        print("⚠️ [list_analyses 오류]:", e)
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

@app.get("/analyses/{analysis_id}")
async def get_analysis_detail(
    analysis_id: str,
    authorization: Optional[str] = Header(None)
):
    """
    🔹 admin / viewer 구분 없이 모든 분석 리포트 조회 가능
    """
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)

    try:
        # ✅ user_id 필터 제거 — 누구든 전체 분석 열람 가능
        res = (
            supabase.table("analyses")
            .select("*")
            .eq("id", analysis_id)
            .maybe_single()
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=404, detail="분석 리포트를 찾을 수 없습니다.")

        return res.data

    except Exception as e:
        print(f"⚠️ 분석 상세 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=f"조회 중 오류: {e}")
    
@app.delete("/analyses/{analysis_id}")
async def delete_analysis(
    analysis_id: str,
    authorization: Optional[str] = Header(None)
):
    """
    DELETE /analyses/{id}
    👉 지정된 분석 리포트를 삭제 (admin만 가능)
    """
    user_id = await get_user_id(authorization)
    role = await get_role(user_id)  # ✅ 역할 확인 추가

    # ✅ viewer는 삭제 불가
    if role != "admin":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다. (admin만 가능)")

    try:
        res = (
            supabase.table("analyses")
            .delete()
            .eq("id", analysis_id)  # ✅ user_id 조건 제거 (모두 접근 가능)
            .execute()
        )

        # Supabase의 delete는 항상 data=[] 반환하므로 검증 보완
        if res.data is None or len(res.data) == 0:
            raise HTTPException(status_code=404, detail="분석 리포트를 찾을 수 없습니다.")

        print(f"🗑️ [분석 삭제 완료] id={analysis_id}, by user={user_id}")
        return {"ok": True, "deleted_id": analysis_id}

    except Exception as e:
        print("⚠️ 분석 삭제 오류:", e)
        raise HTTPException(status_code=500, detail=f"삭제 중 오류: {e}")