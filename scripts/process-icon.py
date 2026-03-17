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

import os
import subprocess
import shutil

def main():
    try:
        source_path = 'src/assets/logo.png'
        if not os.path.exists(source_path):
            print(f"Error: {source_path} not found.")
            sys.exit(1)
            
        im = Image.open(source_path).convert("RGBA")
        
        # 1. Generate the standard app-icon.png (1024x1024)
        target_size = (1024, 1024)
        im_1024 = im.resize(target_size, Image.Resampling.LANCZOS)
        radius = int(im_1024.size[0] * 0.225)
        rounded_im = round_corners(im_1024, radius)
        rounded_im.save('public/app-icon.png', optimize=True)
        print("Successfully saved public/app-icon.png (1024x1024)")

        # 2. Generate .icns file for macOS
        iconset_dir = 'public/icon.iconset'
        if os.path.exists(iconset_dir):
            shutil.rmtree(iconset_dir)
        os.makedirs(iconset_dir)

        # macOS iconset requirements
        sizes = [
            (16, '16x16'), (32, '16x16@2x'),
            (32, '32x32'), (64, '32x32@2x'),
            (128, '128x128'), (256, '128x128@2x'),
            (256, '256x256'), (512, '256x256@2x'),
            (512, '512x512'), (1024, '512x512@2x')
        ]

        for size, name in sizes:
            resized = im.resize((size, size), Image.Resampling.LANCZOS)
            # Apply rounded corners to each size
            r = int(size * 0.225)
            rounded = round_corners(resized, r)
            rounded.save(os.path.join(iconset_dir, f'icon_{name}.png'))

        # Run iconutil to create .icns
        subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', 'public/icon.icns'], check=True)
        
        # Cleanup iconset directory
        shutil.rmtree(iconset_dir)
        
        print("Successfully generated public/icon.icns!")
        
    except Exception as e:
        print(f"Error processing image: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
