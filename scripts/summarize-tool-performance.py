import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def percentile(values, percentile_value):
    ordered = sorted(values)
    index = max(0, math.ceil(percentile_value * len(ordered)) - 1)
    return ordered[index]


def main():
    parser = argparse.ArgumentParser(description="Summarize BIM Personal Agent tool performance telemetry.")
    parser.add_argument("telemetry", type=Path)
    args = parser.parse_args()

    samples = defaultdict(list)
    with args.telemetry.open("r", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                record = json.loads(line)
                samples[record["toolId"]].append(record)

    summary = []
    for tool_name, records in sorted(samples.items()):
        durations = [record["durationMs"] for record in records]
        successful = sum(1 for record in records if record["success"])
        count = len(records)
        p95 = percentile(durations, 0.95)
        success_rate = successful / count
        status = "baseline"
        if count >= 3:
            status = "healthy" if p95 <= 3000 and success_rate >= 0.95 else "review"

        summary.append({
            "tool": tool_name,
            "samples": count,
            "success_rate": round(success_rate, 4),
            "average_ms": round(sum(durations) / count, 1),
            "p95_ms": p95,
            "average_response_bytes": round(
                sum(record["responseBytes"] for record in records) / count,
                1,
            ),
            "routing_status": status,
        })

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
