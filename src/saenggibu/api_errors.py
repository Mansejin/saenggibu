from __future__ import annotations

import re
from typing import Any


def _extract_message(text: str) -> str | None:
    quoted = re.search(r"['\"]message['\"]\s*:\s*['\"]([^'\"]+)['\"]", text)
    if quoted:
        return quoted.group(1).strip()
    return None


def _extract_retry_delay(text: str) -> str | None:
    reset = re.search(r"reset after ([0-9]+m[0-9]*s|[0-9]+s)", text, re.I)
    if reset:
        return reset.group(1)
    retry = re.search(r"retrydelay['\"]?\s*:\s*['\"]?([0-9]+)s", text, re.I)
    if retry:
        sec = int(retry.group(1))
        if sec >= 60:
            return f"{sec // 60}분"
        return f"{sec}초"
    return None


def friendly_api_error(exc: BaseException | str | Any) -> str:
    """Turn provider/SDK errors into short Korean messages for teachers."""
    raw = str(exc).strip()
    if not raw:
        return "알 수 없는 오류가 발생했습니다."

    lowered = raw.lower()
    provider_message = _extract_message(raw) or ""
    provider_lower = provider_message.lower()
    retry_hint = _extract_retry_delay(raw)

    if "이번 달 무료 작성 한도" in raw:
        return raw

    if "high demand" in lowered or "spikes in demand" in lowered:
        return "AI 모델이 일시적으로 과부하 상태입니다. 1~2분 후 다시 시도해 주세요."

    if (
        "no capacity" in lowered
        or "model_capacity" in lowered
        or "capacity on this model" in lowered
        or "capacity exhausted" in lowered
    ):
        suffix = f" ({retry_hint} 후 재시도)" if retry_hint else ""
        return f"이 모델 서버가 일시적으로 가득 찼습니다. 잠시 후 다시 시도하거나 다른 모델로 바꿔 보세요.{suffix}"

    if "prepayment" in lowered or "billing" in lowered and "deplet" in lowered:
        return "Gemini 결제·선불 크레딧 상태를 확인해 주세요. (AI Studio → Billing)"

    if (
        "per minute" in lowered
        or "requests per minute" in lowered
        or "tokens per minute" in lowered
        or "ratelimitexceeded" in lowered
        or "rate limit" in lowered
        or "too many requests" in lowered
        or "429" in lowered
    ):
        suffix = f" 약 {retry_hint} 후" if retry_hint else " 1~2분"
        return (
            "요청이 너무 빠릅니다 (분당 호출 제한). "
            f"AI Studio 한도는 남아 있어도 잠시 쉬었다가{suffix} 다시 시도해 주세요."
        )

    if "resource_exhausted" in lowered or "resource has been exhausted" in lowered:
        if "check quota" in lowered and not retry_hint:
            return (
                "Gemini API가 일시적으로 요청을 거부했습니다. "
                "대시보드 한도와 무관한 속도·모델 용량 제한일 수 있습니다. 1~2분 후 다시 시도해 주세요."
            )
        suffix = f" ({retry_hint} 후)" if retry_hint else ""
        return f"Gemini API 일시 제한{suffix}. 잠시 후 다시 시도해 주세요."

    if "quota" in lowered and ("exceeded" in lowered or "exhausted" in lowered):
        return (
            "Gemini 월간·일일 한도에 도달했을 수 있습니다. "
            "AI Studio 사용량을 확인하거나, 잠시 후 다시 시도해 주세요."
        )

    if "503" in lowered or "unavailable" in lowered:
        if provider_message and len(provider_message) < 120:
            return f"AI 서비스를 일시적으로 사용할 수 없습니다. ({provider_message})"
        return "AI 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."

    if "deadline" in lowered or "timeout" in lowered or "timed out" in lowered:
        return "AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."

    if "api key" in lowered or "apikey" in lowered or "gemini_api_key" in lowered:
        return "Gemini API 키가 설정되지 않았거나 올바르지 않습니다."

    if "connection" in lowered or "connect" in lowered or "network" in lowered:
        return "네트워크 연결에 실패했습니다. 잠시 후 다시 시도하세요."

    if provider_message and len(provider_message) < 160 and "{" not in provider_message:
        return provider_message

    if len(raw) > 160 or "{" in raw or "error" in lowered[:40]:
        return "작성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

    return raw
