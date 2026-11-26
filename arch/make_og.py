import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1200, 630
MARGIN = 84


def main():
    parser = argparse.ArgumentParser(description="1200×630 공유 카드 PNG를 만듭니다.")
    parser.add_argument("--title", required=True, help="여러 줄은 실제 줄바꿈으로 입력합니다.")
    parser.add_argument("--subtitle", default="")
    parser.add_argument("--font", required=True)
    parser.add_argument("--font-index", type=int, default=0)
    parser.add_argument("--title-size", type=int, default=96)
    parser.add_argument("--subtitle-size", type=int, default=36)
    parser.add_argument("--background", required=True)
    parser.add_argument("--foreground", required=True)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "site/assets/og.png")
    args = parser.parse_args()

    try:
        image = Image.new("RGB", (WIDTH, HEIGHT), args.background)
        draw = ImageDraw.Draw(image)
        blocks = [(args.title, args.title_size)]
        if args.subtitle:
            blocks.append((args.subtitle, args.subtitle_size))
        layout = []
        for text, size in blocks:
            font = ImageFont.truetype(args.font, size, index=args.font_index)
            box = draw.multiline_textbbox((0, 0), text, font=font, align="center", spacing=12)
            if box[2] - box[0] > WIDTH - 2 * MARGIN:
                raise ValueError("문구가 카드 너비를 넘습니다. 줄을 나누거나 글자 크기를 줄입니다.")
            layout.append((text, font, box))

        gap = 38
        used_height = sum(box[3] - box[1] for _, _, box in layout) + gap * (len(layout) - 1)
        if used_height > HEIGHT - 2 * MARGIN:
            raise ValueError("문구가 카드 높이를 넘습니다. 줄 수나 글자 크기를 줄입니다.")
        y = (HEIGHT - used_height) / 2
        for text, font, (left, top, right, bottom) in layout:
            x = (WIDTH - right + left) / 2 - left
            draw.multiline_text((x, y - top), text, fill=args.foreground,
                                font=font, align="center", spacing=12)
            y += bottom - top + gap

        args.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output, format="PNG", optimize=True)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"공유 카드 생성 ({args.output}, {WIDTH}×{HEIGHT})")


if __name__ == "__main__":
    main()
