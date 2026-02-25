from PIL import Image
import os
import sys

# ── Configuration ─────────────────────────────
ICON_SIZES      = [72, 96, 128, 144, 152, 192, 384, 512]
SOURCE          = "logo.png"
OUTPUT_DIR      = "icons"
PADDING_PERCENT = 0.30   # 🔥 30% safe padding for round icons


def main():

    if not os.path.exists(SOURCE):
        print("logo.png not found in current folder")
        sys.exit(1)

    img = Image.open(SOURCE).convert("RGBA")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Source size: {img.size}")

    for size in ICON_SIZES:

        # Create white background square
        bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))

        padding = int(size * PADDING_PERCENT)
        inner_size = size - (padding * 2)

        # 🔥 Maintain aspect ratio
        img_copy = img.copy()
        img_copy.thumbnail((inner_size, inner_size), Image.LANCZOS)

        # 🔥 Center align
        x = (size - img_copy.width) // 2
        y = (size - img_copy.height) // 2

        bg.paste(img_copy, (x, y), img_copy)

        output_path = os.path.join(OUTPUT_DIR, f"icon-{size}x{size}.png")
        bg.save(output_path, "PNG")

        print(f"Generated: icon-{size}x{size}.png")

    print("\n✅ All round-safe icons generated successfully!")


if __name__ == "__main__":
    main()