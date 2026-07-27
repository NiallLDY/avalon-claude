#!/usr/bin/env python3
"""角色卡 master PNG → 交付用 WebP。

img_gen 直出的是 1254×1254 PNG（1.2–2.7 MB），太重不能进仓库也不能直接上前端。
本脚本转成 WebP：master 档存进 git，web 档给前端懒加载。

用法:
    python3 scripts/art/optimize-art.py painterly
    python3 scripts/art/optimize-art.py painterly --quality 90

输入: build/art-master/<styleId>/<roleId>.png
输出: assets/roles/<styleId>/<roleId>.webp        原生尺寸 q92，仓库里的权威档
      assets/roles/<styleId>/web/<roleId>.webp    1024² q85，前端实际加载的
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow: apt-get install -y python3-pil", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
STYLES_DIR = Path(__file__).resolve().parent / "styles"
MASTER_DIR = ROOT / "build" / "art-master"
ASSETS_DIR = ROOT / "assets" / "roles"

WEB_SIZE = 1024


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("style")
    ap.add_argument("--quality", type=int, default=92, help="master WebP 质量（默认 92）")
    ap.add_argument("--web-quality", type=int, default=85, help="web WebP 质量（默认 85）")
    args = ap.parse_args()

    style_file = STYLES_DIR / f"{args.style}.json"
    if not style_file.exists():
        print(f"找不到风格文件: {style_file}", file=sys.stderr)
        return 1
    style = json.loads(style_file.read_text(encoding="utf-8"))

    src_dir = MASTER_DIR / style["styleId"]
    out_dir = ASSETS_DIR / style["styleId"]
    web_dir = out_dir / "web"
    web_dir.mkdir(parents=True, exist_ok=True)

    missing, total_master, total_web = [], 0, 0
    for role_id, role in style["roles"].items():
        src = src_dir / f"{role_id}.png"
        if not src.exists():
            missing.append(role_id)
            continue

        with Image.open(src) as im:
            im = im.convert("RGB")
            w, h = im.size

            master = out_dir / f"{role_id}.webp"
            im.save(master, "WEBP", quality=args.quality, method=6)

            web = web_dir / f"{role_id}.webp"
            im.resize((WEB_SIZE, WEB_SIZE), Image.LANCZOS).save(
                web, "WEBP", quality=args.web_quality, method=6
            )

        mk, wk = master.stat().st_size // 1024, web.stat().st_size // 1024
        total_master += mk
        total_web += wk
        print(f"✅ {role_id:16s} {role['name']:8s} {w}×{h}  master {mk} KB  web {wk} KB")

    if missing:
        print(f"\n⚠️  缺 master: {' '.join(missing)}", file=sys.stderr)
        print(f"   先跑: python3 scripts/art/gen-art.py {args.style} {' '.join(missing)}")

    print(f"\nmaster 合计 {total_master // 1024 or total_master} "
          f"{'MB' if total_master > 1024 else 'KB'} → {out_dir.relative_to(ROOT)}")
    print(f"web 合计 {total_web} KB → {web_dir.relative_to(ROOT)}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
