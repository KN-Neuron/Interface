"""Build-only workaround for SciPy's optional docstring cleanup in frozen imports."""
from pathlib import Path
import re


def patch_scipy_cleanup(datas, workpath):
    """Ship a private source copy; never modify installed SciPy or numerical code."""
    target = "scipy/stats/_distn_infrastructure.py"
    found = False
    result = []
    for destination, source, kind in datas:
        if destination.replace("\\", "/") == target:
            found = True
            text = Path(source).read_text(encoding="utf-8")
            # Some frozen imports see no _doc_* globals. The cleanup loop then
            # has no iterations, and its final `del obj` raises NameError.
            text = re.sub(r"(?m)^del obj\s*$", "globals().pop('obj', None)", text)
            patched = Path(workpath) / "patched-scipy" / "_distn_infrastructure.py"
            patched.parent.mkdir(parents=True, exist_ok=True)
            patched.write_text(text, encoding="utf-8")
            source = str(patched)
        result.append((destination, source, kind))
    if not found:
        raise RuntimeError("SciPy cleanup module was not collected as source; cannot apply frozen-import compatibility fix.")
    return result
