from __future__ import annotations

from pathlib import Path


CONFIG_PATH = Path.home() / ".codex" / "config.toml"
SERVER_PATH = Path(__file__).resolve().parents[1] / "gateway" / "build" / "index.js"
TARGET_SECTION = '[mcp_servers."bim-personal-agent"]'
LEGACY_SECTION = '[mcp_servers."revit-mcp"]'


def section_range(lines: list[str], header: str) -> tuple[int, int] | None:
    try:
        start = lines.index(header)
    except ValueError:
        return None
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("["):
            end = index
            break
    return start, end


def main() -> None:
    if not CONFIG_PATH.is_file():
        raise FileNotFoundError(f"Codex config was not found: {CONFIG_PATH}")
    if not SERVER_PATH.is_file():
        raise FileNotFoundError(f"Agent Gateway was not built: {SERVER_PATH}")

    raw = CONFIG_PATH.read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    original = CONFIG_PATH.read_text(encoding="utf-8")
    lines = original.splitlines()
    insertion = len(lines)

    for header in (TARGET_SECTION, LEGACY_SECTION):
        current = section_range(lines, header)
        if current is None:
            continue
        start, end = current
        insertion = min(insertion, start)
        del lines[start:end]

    section = [
        TARGET_SECTION,
        'command = "node"',
        f'args = ["{str(SERVER_PATH).replace(chr(92), chr(92) * 2)}"]',
        'env = { REVIT_VERSION = "2024", BIM_PERSONAL_AGENT_PORT = "9686" }',
        "",
    ]
    lines[insertion:insertion] = section

    backup = CONFIG_PATH.with_name("config.toml.bak-before-bim-agent-gateway")
    if not backup.exists():
        backup.write_text(original, encoding="utf-8", newline=newline)
    CONFIG_PATH.write_text(newline.join(lines).rstrip() + newline, encoding="utf-8", newline="")
    print(f"Codex now uses {TARGET_SECTION}: {SERVER_PATH}")
    print(f"Backup: {backup}")


if __name__ == "__main__":
    main()
