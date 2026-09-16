import pytesseract
from PIL import Image
import io

img = Image.new('RGB', (100, 30), color = (255, 255, 255))
from PIL import ImageDraw, ImageFont
d = ImageDraw.Draw(img)
d.text((10,10), "Hello World", fill=(0,0,0))
text = pytesseract.image_to_string(img)
print("EXTRACTED:", text)
