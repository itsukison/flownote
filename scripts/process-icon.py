from PIL import Image, ImageDraw
import sys

def round_corners(im, radius):
    """Adds rounded corners to an image."""
    circle = Image.new('L', (radius * 2, radius * 2), 0)
    draw = ImageDraw.Draw(circle)
    draw.ellipse((0, 0, radius * 2, radius * 2), fill=255)
    alpha = Image.new('L', im.size, 255)
    w, h = im.size
    alpha.paste(circle.crop((0, 0, radius, radius)), (0, 0))
    alpha.paste(circle.crop((0, radius, radius, radius * 2)), (0, h - radius))
    alpha.paste(circle.crop((radius, 0, radius * 2, radius)), (w - radius, 0))
    alpha.paste(circle.crop((radius, radius, radius * 2, radius * 2)), (w - radius, h - radius))
    im.putalpha(alpha)
    return im

def main():
    try:
        im = Image.open('public/logo.png').convert("RGBA")
        
        # Determine radius based on image size. A standard ratio is about 22.5% of the width for macOS style
        # e.g., 512x512 -> 115 radius
        radius = int(im.size[0] * 0.225)
        rounded_im = round_corners(im, radius)
        
        # Save as png
        rounded_im.save('public/app-icon.png')
        
        # Save as icns (Requires scaling down and saving layered, simple save might not cover all icns features but works mostly in PIL, otherwise we just use the png for electron)
        # Pillow has a bug where it can't natively save .icns with correct standard sizing sometimes. We will stick to using the png for Electron.
        print("Successfully processed app-icon.png!")
    except Exception as e:
        print(f"Error processing image: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
