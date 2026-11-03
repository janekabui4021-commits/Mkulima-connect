from datetime import date, datetime, timezone


_SHELF_LIFE_DAYS = {
    "tomatoes": 7,
    "leafy greens": 4,
    "avocados": 5,
    "bananas": 6,
    "potatoes": 30,
    "default": 10,
}


def _shelf_life_for(produce_name: str) -> int:
    normalized_name = produce_name.strip().lower()
    if "tomato" in normalized_name:
        return _SHELF_LIFE_DAYS["tomatoes"]
    if any(name in normalized_name for name in ("spinach", "sukuma", "kale", "lettuce", "leafy green")):
        return _SHELF_LIFE_DAYS["leafy greens"]
    if "avocado" in normalized_name:
        return _SHELF_LIFE_DAYS["avocados"]
    if "banana" in normalized_name:
        return _SHELF_LIFE_DAYS["bananas"]
    if "potato" in normalized_name:
        return _SHELF_LIFE_DAYS["potatoes"]
    return _SHELF_LIFE_DAYS["default"]


def evaluate_produce_freshness(
    produce_name: str,
    harvest_date_str: str,
    storage_type: str,
) -> dict[str, str | int]:
    harvest_date = date.fromisoformat(harvest_date_str)
    current_date = datetime.now(timezone.utc).date()
    age_in_days = (current_date - harvest_date).days
    if age_in_days < 0:
        raise ValueError("Harvest date cannot be in the future")

    max_shelf_life = _shelf_life_for(produce_name)
    remaining_life = max_shelf_life - age_in_days

    if remaining_life <= 1:
        risk_level = "Critical"
        discount = 30
        message = (
            f"Critical spoilage risk: {produce_name} is near the end of its "
            f"estimated shelf life. Consider a {discount}% clearance discount "
            "and inspect the produce before sale."
        )
    elif remaining_life <= max_shelf_life * 0.4:
        risk_level = "Moderate"
        discount = 15
        message = (
            f"Moderate freshness risk: harvested {age_in_days} days ago. "
            f"Consider a {discount}% promotional discount and inspect the "
            "produce before sale."
        )
    else:
        risk_level = "Fresh"
        discount = 0
        message = (
            f"Estimated freshness is good, with approximately {remaining_life} "
            "days of shelf life remaining."
        )

    return {
        "produce": produce_name,
        "age_in_days": age_in_days,
        "risk_level": risk_level,
        "suggested_discount_pct": discount,
        "ai_recommendation": message,
        "storage_type": storage_type,
        "method": "rule_based_estimate",
        "storage_note": (
            "Storage type is recorded but does not change this estimate. Actual "
            "freshness depends on temperature, handling, variety, and condition."
        ),
    }
