"""Crops and JPEG conversion for the manual's figures (needs Pillow).

Run after screenshots.mjs and screenshot-log.mjs:  python3 crops.py
Boxes are in 2x device pixels of the 1180x860 desktop viewport.
"""
import glob, os
from PIL import Image

os.chdir(os.path.dirname(os.path.abspath(__file__)))
S = 'shots/'
# The administration panel is its own tab since 0.7.3 and no longer runs the
# height of the On air tab, so crop to the width and to whatever height it is.
_admin = Image.open(S + 'admin.png')
_admin.crop((0, 0, min(1920, _admin.width), min(1600, _admin.height))).save(S + 'admin-top.png')
air = Image.open(S + 'air-contact.png')
air.crop((220, 1586, 2140, 2116)).save(S + 'heard.png')      # the Heard panel
air.crop((220, 2156, 2140, 2716)).save(S + 'your-key.png')   # Your key
air.crop((220, 440, 2140, 1560)).save(S + 'air-top.png')     # lamps + scope + VFO (cover)
Image.open(S + 'air-signin.png').crop((220, 330, 2140, 1500)).save(S + 'signin.png')

os.makedirs('shots-jpg', exist_ok=True)
for f in glob.glob(S + '*.png'):
    im = Image.open(f).convert('RGB')
    if im.width > 800:
        im = im.resize((int(im.width * 0.75), int(im.height * 0.75)), Image.LANCZOS)
    im.save('shots-jpg/' + os.path.basename(f)[:-4] + '.jpg', quality=80, optimize=True, subsampling=1)
print('done')
