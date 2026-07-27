#!/usr/bin/env python3
"""批量生成角色卡插画。

每个角色起一个 `codex exec` 子进程，让它调用内置的 img_gen 出图。
codex 用 ChatGPT 账号登录即可，不需要 OPENAI_API_KEY。

用法:
    python3 scripts/art/gen-art.py painterly                  # 全部 10 个角色
    python3 scripts/art/gen-art.py painterly merlin morgana   # 只重出指定角色
    python3 scripts/art/gen-art.py painterly --jobs 2         # 调并发（默认 3）

产物: build/art-master/<styleId>/<roleId>.png （1254×1254 原始 PNG）
之后跑 optimize-art.py 转成 assets/roles/<styleId>/<roleId>.webp
"""

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STYLES_DIR = Path(__file__).resolve().parent / "styles"
MASTER_DIR = ROOT / "build" / "art-master"

# 单张图 codex 实测 1.5–2 分钟，给足冗余
TIMEOUT_SEC = 600


def build_prompt(style: dict, role_id: str) -> str:
    """风格圣经 → 完整提示词。suffix / palette 逐字复用，这是全套统一的关键。"""
    role = style["roles"][role_id]
    return ", ".join(
        [
            role["subject"],
            style["palette"][role["side"]],
            style["suffix"],
        ]
    )


def build_instruction(role_id: str, prompt: str, ref_note: str | None) -> str:
    # "Do NOT resize or post-process" 是必须的：否则 codex 会自己写个缩放脚本把图糊掉。
    head = (
        f"Use your image generation tool (img_gen) to generate ONE image and save it "
        f"as ./{role_id}.png in the current directory. "
        f"Do NOT resize, crop, convert or post-process it in any way — save exactly what "
        f"the tool returns. Do not write any helper scripts."
    )
    if ref_note:
        head += f"\n\n{ref_note}"
    return f"{head}\n\nPrompt: {prompt}\n\nAfter saving, print only the file size and pixel dimensions."


# 让同一个人物在不同卡面上保持同一张脸时用的默认说明
DEFAULT_REF_NOTE = (
    "Keep the SAME face, hairstyle and build as the character in the attached "
    "reference image — it must read as the same person, only re-costumed and "
    "re-lit. Do not change the facial structure, jawline, or hair length/texture."
)


def generate(style: dict, role_id: str, outdir: Path, force: bool) -> tuple[str, bool, str]:
    target = outdir / f"{role_id}.png"
    if target.exists() and not force:
        return role_id, True, f"已存在，跳过（--force 可覆盖）: {target.name}"

    role = style["roles"][role_id]
    ref_id = role.get("reference")
    ref_args: list[str] = []
    ref_note: str | None = None

    if ref_id:
        ref_path = outdir / f"{ref_id}.png"
        if not ref_path.exists():
            return role_id, False, f"缺参考图 {ref_path.name}，请先生成 {ref_id}"
        ref_note = role.get("referenceNote", DEFAULT_REF_NOTE)
        # 关键：-i 是变长参数，不加 "--" 的话紧随其后的 prompt 会被当成第二张图路径吃掉，
        # 结果 codex 以为没有 prompt、转去读空的 stdin 然后报错。别删这个分隔符。
        ref_args = ["-i", str(ref_path), "--"]

    instruction = build_instruction(role_id, build_prompt(style, role_id), ref_note)
    cmd = [
        "codex", "exec",
        "-C", str(outdir),
        "--sandbox", "workspace-write",
        "--skip-git-repo-check",
        *ref_args,
        instruction,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=TIMEOUT_SEC
        )
    except subprocess.TimeoutExpired:
        return role_id, False, f"超时 {TIMEOUT_SEC}s"

    if not target.exists():
        tail = (proc.stdout or proc.stderr or "")[-600:]
        return role_id, False, f"codex 退出码 {proc.returncode}，未产出文件\n{tail}"

    return role_id, True, f"{target.stat().st_size // 1024} KB"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("style", help="风格 ID，对应 scripts/art/styles/<style>.json")
    ap.add_argument("roles", nargs="*", help="只生成这些角色（默认全部）")
    ap.add_argument("--jobs", type=int, default=3, help="并发数（默认 3）")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的图")
    args = ap.parse_args()

    style_file = STYLES_DIR / f"{args.style}.json"
    if not style_file.exists():
        print(f"找不到风格文件: {style_file}", file=sys.stderr)
        return 1
    style = json.loads(style_file.read_text(encoding="utf-8"))

    role_ids = args.roles or list(style["roles"])
    unknown = [r for r in role_ids if r not in style["roles"]]
    if unknown:
        print(f"未知角色: {', '.join(unknown)}", file=sys.stderr)
        return 1

    outdir = MASTER_DIR / style["styleId"]
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"风格 {style['styleId']}（{style['displayName']}）· {len(role_ids)} 个角色 · 并发 {args.jobs}")
    print(f"输出目录 {outdir}\n")

    # 带参考图的角色必须等参考图先出来，所以分两批跑
    waves = [
        [r for r in role_ids if not style["roles"][r].get("reference")],
        [r for r in role_ids if style["roles"][r].get("reference")],
    ]

    failed = []
    for wave in waves:
        if not wave:
            continue
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(generate, style, rid, outdir, args.force) for rid in wave]
            for fut in futures:
                role_id, ok, msg = fut.result()
                name = style["roles"][role_id]["name"]
                print(f"{'✅' if ok else '❌'} {role_id:16s} {name:8s} {msg}")
                if not ok:
                    failed.append(role_id)

    if failed:
        print(f"\n失败 {len(failed)} 个: {' '.join(failed)}", file=sys.stderr)
        print(f"重试: python3 {Path(__file__).relative_to(ROOT)} {args.style} {' '.join(failed)}")
        return 1

    print(f"\n全部完成。下一步: python3 scripts/art/optimize-art.py {args.style}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
