"""Render a branded JPEG from a rolling content bank. No paid generation API."""
import argparse
import datetime as dt
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
W,H=1080,1350
NAVY=(9,20,36)
WHITE=(242,248,251)
MUTED=(165,187,203)
TEAL=(38,213,190)
BLUE=(66,151,245)
def font(size,bold=False):
    return ImageFont.truetype('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf',size)
def wrap(draw,text,f,width):
    lines,line=[],''
    for word in text.split():
        trial=(line+' '+word).strip()
        if draw.textlength(trial,font=f)<=width: line=trial
        else:
            if not line: raise ValueError('Word does not fit')
            lines.append(line)
            line=word
    if line: lines.append(line)
    return lines
def select_post(date,sequence=None):
    bank=json.loads((ROOT/'content/evergreen-posts.json').read_text())
    offset=(dt.date.fromisoformat(date)-dt.date(2026,9,26)).days if sequence is None else sequence
    item=bank[offset % len(bank)]
    caption=item['title']+'\n\n'+'\n'.join(item['tips'])+'\n\n'+item['cta']
    caption+='\n\n#LocalTrafficAI #LocalBusiness #SmallBusinessMarketing'
    if len(caption)>2200 or not caption.isascii(): raise ValueError('Invalid caption')
    return dict(item,date=date,caption=caption,bank_index=offset % len(bank))
def render(post,output):
    image=Image.new('RGB',(W,H),NAVY);d=ImageDraw.Draw(image)
    for x in range(0,W,90): d.line((x,0,x,H),fill=(14,29,46))
    for y in range(0,H,90): d.line((0,y,W,y),fill=(14,29,46))
    for r in (180,260,340): d.arc((850-r,-180-r,850+r,-180+r),0,360,fill=(18,66,79),width=3)
    d.rounded_rectangle((64,64,116,116),radius=15,fill=TEAL)
    d.ellipse((80,77,101,98),outline=NAVY,width=4)
    d.polygon([(82,95),(99,95),(90,108)],fill=NAVY)
    d.text((136,68),'LocalTrafficAI',font=font(37,True),fill=WHITE)
    d.text((64,173),post['category'].upper(),font=font(22,True),fill=TEAL)
    d.line((64,225,1016,225),fill=(35,60,78),width=2)
    chosen=None
    for size in range(78,51,-2):
        f=font(size,True);lines=wrap(d,post['title'],f,952)
        if len(lines)*(size+14)<=285: chosen=f;break
    if chosen is None: raise ValueError('Title does not fit')
    y=270
    for line in lines: d.text((64,y),line,font=chosen,fill=WHITE);y+=size+14
    y=max(y+50,595)
    for i,tip in enumerate(post['tips'],1):
        d.rounded_rectangle((64,y+4,110,y+50),radius=13,fill=(23,58,71))
        d.text((78,y+9),str(i),font=font(23,True),fill=TEAL)
        for line in wrap(d,tip,font(31),857):
            d.text((139,y),line,font=font(31),fill=MUTED);y+=44
        y+=32
    if y>1115: raise ValueError('Body does not fit')
    d.rounded_rectangle((64,1160,1016,1243),radius=21,fill=(18,49,66),outline=(29,95,113),width=2)
    d.text((91,1184),'SAVE THIS FOR YOUR NEXT BUSINESS CHECK',font=font(22,True),fill=TEAL)
    d.text((64,1290),'localtrafficai.com',font=font(22),fill=WHITE)
    d.text((861,1290),'LOCAL / AI',font=font(19,True),fill=BLUE)
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    image.save(output/'post.jpg','JPEG',quality=92,optimize=True,progressive=False)
    (output/'post.json').write_text(json.dumps(post,indent=2)+'\n')
    assert 1000 < (output/'post.jpg').stat().st_size < 8*1024*1024
    return output/'post.jpg'
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--date',required=True);p.add_argument('--output',default='.output')
    p.add_argument('--sequence',type=int)
    a=p.parse_args();print('Generated',render(select_post(a.date,a.sequence),a.output),'for',a.date)
