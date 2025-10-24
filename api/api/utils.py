import os
import re
import io
import csv
import tempfile
from typing import Dict, Any, Optional, List

import pandas as pd
import numpy as np
from xlsx2csv import Xlsx2csv

# =========================
# 1) 벤더(거래처) 이름 정규화
# =========================
NORMALIZE_MAP = {
    r"starbucks|스타벅스": "스타벅스",
    r"gs25|gs\s*25|지에스25": "GS25",
    r"cu\s?편의점|cu\b": "CU",
    r"emart24|이마트24": "이마트24",
    r"seven\s*eleven|세븐일레븐|7\-?11": "세븐일레븐",
}

def normalize_vendor(text: str) -> str:
    if text is None:
        return ""
    s_raw = str(text).strip()
    s = s_raw.lower()
    for pat, rep in NORMALIZE_MAP.items():
        if re.search(pat, s):
            return rep
    return s_raw


# =========================================
# 2) 스프레드시트 로더 (header=None 기본)
# =========================================
def load_spreadsheet(content: bytes, filename: str) -> pd.DataFrame:
    name = (filename or "").lower()
    ext = os.path.splitext(name)[1]
    errors: List[str] = []

    # XLSX
    if ext in (".xlsx", ".xlsm", ".xltx", ".xltm", ""):
        try:
            return pd.read_excel(io.BytesIO(content), engine="openpyxl", header=None, dtype=str)
        except Exception as e:
            errors.append(f"openpyxl: {e}")

    # XLS
    if ext == ".xls":
        try:
            return pd.read_excel(io.BytesIO(content), engine="xlrd", header=None, dtype=str)
        except Exception as e:
            errors.append(f"xlrd: {e}")

    # XLSB
    if ext == ".xlsb":
        try:
            return pd.read_excel(io.BytesIO(content), engine="pyxlsb", header=None, dtype=str)
        except Exception as e:
            errors.append(f"pyxlsb: {e}")

    # CSV
    if ext == ".csv":
        for enc in ("utf-8-sig", "cp949", "euc-kr"):
            try:
                return pd.read_csv(io.BytesIO(content), encoding=enc, engine="python", header=None, dtype=str)
            except Exception as e:
                errors.append(f"csv({enc}): {e}")

    # XLSX2CSV fallback
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as f:
            f.write(content)
            f.flush()
            out = io.StringIO()
            Xlsx2csv(f.name, outputencoding="utf-8", skip_empty_rows=True).convert(out)
            csv_text = out.getvalue()
            return pd.read_csv(io.StringIO(csv_text), engine="python", header=None, on_bad_lines="skip", dtype=str)
    except Exception as e:
        errors.append(f"xlsx2csv: {e}")

    # Final CSV sniff
    try:
        text = content.decode("utf-8-sig", errors="ignore")
        return pd.read_csv(io.StringIO(text), engine="python", header=None, dtype=str)
    except Exception as e:
        errors.append(f"csv-final: {e}")

    raise ValueError("스프레드시트 파싱 실패 → " + " | ".join(errors))


# =========================================
# 3) 우리은행 엑셀 전용 파서
# =========================================
def parse_woori_excel(df: pd.DataFrame) -> Optional[pd.DataFrame]:
    """우리은행 거래내역 파일 구조 감지 및 변환"""
    if df.shape[1] < 5:
        return None

    header_row = None
    for i in range(min(30, len(df))):
        row = "".join(str(x) for x in df.iloc[i].tolist())
        if "거래일시" in row and "적요" in row and "입금" in row:
            header_row = i
            break
    if header_row is None:
        return None

    df_data = df.iloc[header_row + 1:].copy()
    df_data.columns = [str(x).strip() for x in df.iloc[header_row].tolist()]
    needed = ["거래일시", "적요", "기재내용", "지급(원)", "입금(원)", "거래후 잔액(원)", "취급점"]
    if not all(c in df_data.columns for c in needed):
        return None

    # 숫자 처리
    for c in ["지급(원)", "입금(원)", "거래후 잔액(원)"]:
        df_data[c] = (
            df_data[c]
            .astype(str)
            .str.replace(",", "")
            .str.replace("원", "")
            .replace("-", "0")
            .replace("", "0")
            .astype(float)
        )

    df_data = df_data[needed].dropna(subset=["거래일시"]).reset_index(drop=True)
    df_data["거래일시"] = pd.to_datetime(df_data["거래일시"], errors="coerce")

    # 표준화
    df_data.rename(
        columns={
            "거래일시": "date",
            "적요": "type",
            "기재내용": "description",
            "지급(원)": "out_amount",
            "입금(원)": "in_amount",
            "거래후 잔액(원)": "balance",
            "취급점": "branch",
        },
        inplace=True,
    )

    df_data["amount"] = df_data["in_amount"] - df_data["out_amount"]
    df_data["tx_type"] = df_data["amount"].apply(lambda x: "IN" if x > 0 else "OUT")

    return df_data

# =========================================
# 3-B) 국민은행 엑셀 전용 파서
# =========================================
def parse_kb_excel(df: pd.DataFrame) -> Optional[pd.DataFrame]:
    """국민은행 거래내역 파일 구조 감지 및 변환"""
    if df.shape[1] < 5:
        return None

    header_row = None
    for i in range(min(30, len(df))):
        row_text = "".join(str(x) for x in df.iloc[i].tolist())
        # ✅ 국민은행은 "거래일시" + "보낸분/받는분" 컬럼으로 판단
        if "거래일시" in row_text and ("보낸분" in row_text or "받는분" in row_text):
            header_row = i
            break
    if header_row is None:
        return None

    df_data = df.iloc[header_row + 1:].copy()
    df_data.columns = [str(x).strip() for x in df.iloc[header_row].tolist()]

    needed = ["거래일시", "보낸분/받는분", "출금액(원)", "입금액(원)", "잔액(원)"]
    if not all(c in df_data.columns for c in needed):
        return None

    # ✅ 숫자 컬럼 정리
    for c in ["출금액(원)", "입금액(원)", "잔액(원)"]:
        df_data[c] = (
            df_data[c]
            .astype(str)
            .str.replace(",", "")
            .str.replace("원", "")
            .replace("-", "0")
            .replace("", "0")
            .astype(float)
        )

    df_data = df_data[needed].dropna(subset=["거래일시"]).reset_index(drop=True)
    df_data["거래일시"] = pd.to_datetime(df_data["거래일시"], errors="coerce")

    # ✅ 표준화
    df_data.rename(
        columns={
            "거래일시": "date",
            "보낸분/받는분": "description",
            "출금액(원)": "out_amount",
            "입금액(원)": "in_amount",
            "잔액(원)": "balance",
        },
        inplace=True,
    )

    # ✅ 금액 계산: 입금 - 출금
    df_data["amount"] = df_data["in_amount"] - df_data["out_amount"]
    df_data["tx_type"] = df_data["amount"].apply(lambda x: "IN" if x > 0 else "OUT")

    return df_data

# =========================================
# 4) 범용 헤더 탐색 & 컬럼 통합 (기존)
# =========================================
_HEADER_KEYWORDS = {
    "date":  [r"날짜", r"거래일", r"일자", r"승인일자", r"거래\s*시간"],
    "desc":  [r"내용", r"적요", r"거래내용", r"가맹점명", r"받는.?분", r"보내.?는.?분"],
    "memo":  [r"메모", r"비고"],
    "dep":   [r"입금", r"받은금액", r"credit"],
    "wd":    [r"출금", r"보낸금액", r"debit"],
    "amt":   [r"금액", r"이체금액", r"거래금액"],
}

def _norm_str(x) -> str:
    try:
        return str(x).replace("\u00a0", " ").strip()
    except Exception:
        return ""

def _has_kw(s: str, pats) -> bool:
    s2 = _norm_str(s)
    return any(re.search(p, s2, re.I) for p in pats)

def _guess_header_row(df: pd.DataFrame, scan_rows: int = 80) -> Optional[int]:
    for i in range(min(scan_rows, len(df))):
        row = [_norm_str(v) for v in df.iloc[i].tolist()]
        hits = 0
        for cell in row:
            if _has_kw(cell, _HEADER_KEYWORDS["date"]): hits += 1
            if _has_kw(cell, _HEADER_KEYWORDS["desc"]): hits += 1
            if _has_kw(cell, _HEADER_KEYWORDS["amt"]):  hits += 1
            if _has_kw(cell, _HEADER_KEYWORDS["dep"]):  hits += 1
            if _has_kw(cell, _HEADER_KEYWORDS["wd"]):   hits += 1
        if hits >= 2:
            return i
    return None

def _parse_money(v) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    s = re.sub(r"[₩원,\s]", "", str(v))
    if s == "":
        return 0.0
    try:
        return float(s)
    except:
        return 0.0

def unify_columns(df: pd.DataFrame) -> pd.DataFrame:
    # 우리은행 자동 감지
    woori = parse_woori_excel(df)
    if woori is not None:
        return woori
    
    # ✅ 국민은행 자동 감지
    kb = parse_kb_excel(df)
    if kb is not None:
        return kb

    df = df.dropna(how="all", axis=1)
    df = df.dropna(how="all", axis=0).reset_index(drop=True)
    idx = _guess_header_row(df)
    if idx is None:
        raise ValueError("헤더를 찾지 못했습니다.")

    new_cols = [_norm_str(v) for v in df.iloc[idx].tolist()]
    df = df.iloc[idx + 1:].copy()
    df.columns = new_cols
    df.reset_index(drop=True, inplace=True)

    cols = list(df.columns)
    col_date = next((c for c in cols if _has_kw(c, _HEADER_KEYWORDS["date"])), None)
    col_desc = next((c for c in cols if _has_kw(c, _HEADER_KEYWORDS["desc"])), None)
    col_dep  = next((c for c in cols if _has_kw(c, _HEADER_KEYWORDS["dep"])), None)
    col_wd   = next((c for c in cols if _has_kw(c, _HEADER_KEYWORDS["wd"])), None)
    col_amt  = next((c for c in cols if _has_kw(c, _HEADER_KEYWORDS["amt"])), None)

    if not col_date or not col_desc:
        raise ValueError(f"필수 컬럼 누락: {cols}")

    if col_dep or col_wd:
        dep_v = [_parse_money(a) for a in df[col_dep]] if col_dep else [0]*len(df)
        wd_v  = [_parse_money(a) for a in df[col_wd]] if col_wd else [0]*len(df)
        amount_series = [d - w for d, w in zip(dep_v, wd_v)]
    elif col_amt:
        amount_series = [_parse_money(a) for a in df[col_amt]]
    else:
        raise ValueError("금액 컬럼 없음")

    out = pd.DataFrame({
        "date": pd.to_datetime(df[col_date], errors="coerce"),
        "description": df[col_desc],
        "amount": amount_series
    })
    out = out[~(out["date"].isna() & (out["description"].astype(str).str.strip() == ""))]
    out.reset_index(drop=True, inplace=True)

    # ✅ 잔액 컬럼 자동 인식 (우리/국민 외 일반 엑셀 대비)
    if '잔액' in df.columns or '거래후 잔액' in df.columns or '잔액(원)' in df.columns:
        for c in ['잔액', '거래후 잔액', '잔액(원)']:
            if c in df.columns:
                out['balance'] = [_parse_money(v) for v in df[c]]
                break
    else:
        out['balance'] = 0.0  # 기본값
    return out


# =========================================
# 5) 규칙 적용
# =========================================
def _safe_lower(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and (np.isnan(v) or pd.isna(v)):
        return ""
    return str(v).lower()

def apply_rules(row: Dict[str, Any], rules: list) -> Dict[str, Any]:
    desc   = _safe_lower(row.get("description"))
    memo   = _safe_lower(row.get("memo"))
    vendor = _safe_lower(row.get("vendor_normalized"))

    result = {
        "category": "미분류",
        "category_l1": None,
        "category_l2": None,
        "category_l3": None,
        "is_fixed": False
    }

    for r in rules:
        kw  = _safe_lower(r.get("keyword"))
        tgt = (r.get("target") or "any").lower()
        if not kw:
            continue

        hit = (
            (tgt == "description" and kw in desc) or
            (tgt == "memo" and kw in memo) or
            (tgt == "vendor" and kw in vendor) or
            (tgt == "any" and (kw in desc or kw in memo or kw in vendor))
        )
        if hit:
            c1, c2, c3 = r.get("category_l1"), r.get("category_l2"), r.get("category_l3")
            cat = r.get("category") or c3 or c2 or c1 or "미분류"
            result.update({
                "category": cat,
                "category_l1": c1,
                "category_l2": c2,
                "category_l3": c3,
                "is_fixed": bool(r.get("is_fixed", False))
            })
            return result

    return result
