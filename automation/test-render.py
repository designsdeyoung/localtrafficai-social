import datetime as dt
import importlib.util
import json
import tempfile
from pathlib import Path
from PIL import Image
p=Path(__file__).with_name('render-post.py')
spec=importlib.util.spec_from_file_location('renderer',p)
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
bank=json.loads((r.ROOT/'content/evergreen-posts.json').read_text())
assert len(bank)>=30
assert len({x['title'] for x in bank})==len(bank)
with tempfile.TemporaryDirectory() as temp:
    for i in range(len(bank)):
        date=(dt.date(2026,9,26)+dt.timedelta(days=i)).isoformat()
        post=r.select_post(date)
        target=r.render(post,Path(temp)/str(i))
        with Image.open(target) as im:
            assert im.format=='JPEG' and im.size==(1080,1350) and im.mode=='RGB'
        assert post['caption'].isascii() and len(post['caption'])<=2200
    assert r.select_post('2027-01-15')['date']=='2027-01-15'
    # Three different images/captions can share the same date during the burst.
    posts=[r.select_post('2026-09-27',sequence=i) for i in (1,2,3)]
    assert len({p['caption'] for p in posts})==3
    assert [p['bank_index'] for p in posts]==[1,2,3]
    assert r.select_post('2026-09-30',sequence=10)['bank_index']==10
print(f'PASS: {len(bank)} complete post graphics, JPEG dimensions, size, captions, and dates beyond the old calendar.')
