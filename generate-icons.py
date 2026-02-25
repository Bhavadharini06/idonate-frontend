from PIL import Image
import os
import sys

ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
SOURCE = "logo.png"
OUTPUT_DIR = "icons"
PADDING_PERCENT = 0.10

def main():

    if not os.path.exists(SOURCE):
        print("logo.png not found")
        sys.exit(1)

    img = Image.open(SOURCE).convert("RGBA")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for size in ICON_SIZES:

        # 🔥 Transparent background instead of white
        bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))

        padding = int(size * PADDING_PERCENT)
        inner_size = size - padding * 2

        img_copy = img.copy()
        img_copy.thumbnail((inner_size, inner_size), Image.LANCZOS)

        x = (size - img_copy.width) // 2
        y = (size - img_copy.height) // 2

        bg.paste(img_copy, (x, y), img_copy)

        out_path = os.path.join(OUTPUT_DIR, f"icon-{size}x{size}.png")
        bg.save(out_path, "PNG")

    print("Done!")

if __name__ == "__main__":
    main()