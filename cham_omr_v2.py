"""OMR scanner for the 60-question A4 portrait answer sheet.

Primary geometry is derived exclusively from the four outlined black corner
markers (using the center of each solid inner square). A marker-derived
homography rectifies each photo to the fixed A4 raster size; all downstream
coordinates are mapped from one shared template coordinate system.
Requires opencv-python, numpy, pandas, openpyxl.
"""
from __future__ import annotations
import argparse, itertools, json, logging, math, struct, zlib
from pathlib import Path
import cv2
import numpy as np
import pandas as pd

LOG = logging.getLogger("omr")
W, H = 2480, 3508
TEMPLATE_W, TEMPLATE_H = 1024.0, 1448.0
MAX_QUESTIONS, DEFAULT_QUESTIONS, DEFAULT_MAX_SCORE = 60, 50, 10.0
CHOICES = ["A", "B", "C", "D"]

# Layout constants use a 1024 x 1448 reference grid and scale into the fixed
# 2480 x 3508 A4 portrait raster for every normalized sheet.
def X(x): return float(x) * W / TEMPLATE_W
def Y(y): return float(y) * H / TEMPLATE_H
def XY(x, y): return (X(x), Y(y))

def configure_geometry(width, height):
    """Configure all layout coordinates for the current rectified raster size."""
    global W, H, MARKER_DST, SID_X, SID_Y, EXAM_X, EXAM_Y
    global ANSWER_X, ANSWER_Y_TEMPLATE, ANSWER_Y, ANSWER_MARKER_X, BOTTOM_MARKER_X
    W, H = int(width), int(height)
    # Use a single near-uniform scale for the A4 template; width/height rounding
    # may differ by at most a pixel, preserving the intended paper aspect ratio.
    MARKER_DST = np.array([XY(56, 49), XY(969, 49), XY(969, 1400), XY(56, 1400)], np.float32)
    SID_X = [X(v) for v in (692, 724, 755, 786)]
    SID_Y = [Y(v) for v in (194, 218, 243, 267, 293, 319, 345, 370, 396, 421)]
    EXAM_X = [X(906), X(938)]
    EXAM_Y = SID_Y[:]
    # Bubble centers and row-marker centers measured from the supplied PDF,
    # registered to the four primary-marker centers and expressed in the
    # 1024 x 1448 reference grid. These seed coordinates are then scaled into
    # the fixed 2480 x 3508 image; detected secondary markers refine each row.
    ANSWER_X = [
        [X(v) for v in (116, 156, 198, 237)],
        [X(v) for v in (358, 398, 438, 477)],
        [X(v) for v in (597, 637, 676, 714)],
        [X(v) for v in (834, 874, 913, 952)],
    ]
    ANSWER_Y_TEMPLATE = [549, 600, 654, 706, 760, 815, 869, 922, 977, 1032, 1087, 1141, 1196, 1251, 1307]
    ANSWER_Y = [Y(v) for v in ANSWER_Y_TEMPLATE]
    ANSWER_MARKER_X = [X(v) for v in (261, 499, 735, 974)]
    BOTTOM_MARKER_X = [[X(v) for v in col] for col in ((114, 154, 198, 238), (358, 399, 440, 480), (600, 641, 682, 721), (836, 876, 916, 956))]

# Initialize to the template coordinate size; each image reconfigures this after
# the four primary markers determine the appropriate output raster scale.
configure_geometry(2480, 3508)


def _order_quad(points):
    p = np.asarray(points, np.float32)
    if p.shape != (4, 2): raise ValueError("Expected exactly four points")
    s = p.sum(axis=1); d = p[:, 0] - p[:, 1]
    # TL, TR, BR, BL
    out = np.array([p[np.argmin(s)], p[np.argmax(d)], p[np.argmax(s)], p[np.argmin(d)]], np.float32)
    if len({tuple(np.round(v, 1)) for v in out}) != 4:
        raise ValueError("Corner markers do not form four distinct corners")
    return out


def _square_like(contour):
    area = cv2.contourArea(contour)
    if area < 25: return None
    peri = cv2.arcLength(contour, True)
    if peri <= 0: return None
    approx = cv2.approxPolyDP(contour, 0.045 * peri, True)
    if len(approx) != 4 or not cv2.isContourConvex(approx): return None
    x, y, w, h = cv2.boundingRect(approx)
    if min(w, h) < 5 or max(w, h) / max(1, min(w, h)) > 1.35: return None
    return (x, y, w, h, area)


def detect_primary_markers(image):
    """Find four nested square-frame + solid-core markers; return TL,TR,BR,BL core centers.

    Detection uses multi-threshold contours and nested square geometry, then
    validates the resulting quadrilateral. It deliberately does not select
    points merely because they are near the photo's corners.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image.copy()
    # Reduce contour workload on large phone photos while retaining marker detail.
    original_h, original_w = gray.shape
    detect_scale = min(1.0, 1600.0 / max(original_h, original_w))
    if detect_scale < 1.0:
        gray = cv2.resize(gray, None, fx=detect_scale, fy=detect_scale, interpolation=cv2.INTER_AREA)
    # Mild local contrast normalization helps with shadows and uneven lighting.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    h, w = gray.shape
    found = []
    for src in (gray, clahe):
        for thresh in (45, 65, 85, 105, 130, 155, 180):
            bw = cv2.threshold(src, thresh, 255, cv2.THRESH_BINARY_INV)[1]
            contours, hierarchy = cv2.findContours(bw, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            if hierarchy is None: continue
            hierarchy = hierarchy[0]
            squares = []
            for i, c in enumerate(contours):
                sq = _square_like(c)
                if sq is None: continue
                x, y, sw, sh, area = sq
                # A frame must be large enough to be a primary marker but not a page/table border.
                if not (0.012 * min(h, w) <= max(sw, sh) <= 0.13 * min(h, w)): continue
                M = cv2.moments(c)
                if abs(M["m00"]) < 1e-6: continue
                cx, cy = M["m10"] / M["m00"], M["m01"] / M["m00"]
                squares.append((i, np.array([cx, cy], np.float32), sw, sh, area, x, y))
            # Each primary marker has a smaller solid square nested inside an outlined square.
            for fi, fc, fw, fh, fa, fx, fy in squares:
                for ii, ic, iw, ih, ia, ix, iy in squares:
                    if ii == fi or ia >= fa: continue
                    scale = max(fw, fh) / max(1.0, max(iw, ih))
                    if not 1.35 <= scale <= 3.4: continue
                    if np.linalg.norm(fc - ic) > 0.20 * max(fw, fh): continue
                    if not (fx - 1 <= ix <= fx + fw + 1 and fy - 1 <= iy <= fy + fh + 1): continue
                    # Core should be dark and substantial; contour area ratio rejects hollow text squares.
                    ratio = ia / max(fa, 1.0)
                    if not 0.08 <= ratio <= 0.70: continue
                    found.append((ic, float(fa), float(ratio)))
    if not found:
        raise RuntimeError("Could not detect any primary black corner marker (solid square inside outlined square).")
    # Merge detections from multiple thresholds at the same marker center.
    merged = []
    for center, area, ratio in sorted(found, key=lambda z: z[1], reverse=True):
        hit = next((q for q in merged if np.linalg.norm(center - q[0]) < max(8.0, 0.012 * min(h, w))), None)
        if hit is None: merged.append([center, 1, area, ratio])
        else:
            hit[0] = (hit[0] * hit[1] + center) / (hit[1] + 1)
            hit[1] += 1; hit[2] = max(hit[2], area); hit[3] = max(hit[3], ratio)
    # Prefer strong nested-square candidates, but keep spatially distinct candidates.
    candidates = sorted(merged, key=lambda q: (q[1], q[2]), reverse=True)
    candidates = candidates[:16]
    if len(candidates) < 4:
        raise RuntimeError(f"Only {len(candidates)} primary-marker candidates found; four are required.")
    best = None
    for combo in itertools.combinations(candidates, 4):
        pts = np.array([q[0] for q in combo], np.float32)
        try: ordered = _order_quad(pts)
        except ValueError: continue
        contour = ordered.reshape(-1, 1, 2)
        area = abs(cv2.contourArea(contour))
        if area < 0.12 * w * h: continue
        edges = [np.linalg.norm(ordered[(i+1)%4] - ordered[i]) for i in range(4)]
        if min(edges) < 0.20 * min(h, w): continue
        # Convexity and plausible portrait-page ratio; tolerate strong perspective.
        cross = []
        for i in range(4):
            a, b, c = ordered[i], ordered[(i+1)%4], ordered[(i+2)%4]
            ab = b - a
            bc = c - b
            cross.append(float(ab[0] * bc[1] - ab[1] * bc[0]))
        if min(cross) * max(cross) <= 0: continue
        observed = ((edges[0] + edges[2]) / 2) / max(1e-6, (edges[1] + edges[3]) / 2)
        if not 0.30 <= observed <= 1.60: continue
        # Marker centers should enclose the page, not be a group of internal black squares.
        # Prefer the expected portrait geometry, but do not reject a sideways
        # photograph here: rectify_to_a4() can rotate the whole image first.
        score = area / (w*h) + 0.003 * sum(q[1] for q in combo) - abs(math.log(observed / (210/297))) * 0.035
        if best is None or score > best[0]: best = (score, ordered)
    if best is None:
        raise RuntimeError("Four primary-marker candidates were found, but their geometry is invalid/degenerate.")
    return best[1] / detect_scale


def rectify_to_a4(image):
    """Rectify from the four primary marker centers and normalize to A4.

    For a sideways capture, both 90-degree orientations are evaluated after
    homography. The orientation with the strongest match to the known secondary
    answer-row markers is selected; these markers only score orientation/local
    layout and never replace the primary markers as the global reference.
    """
    if image is None or not isinstance(image, np.ndarray) or image.size == 0:
        raise ValueError("Input image is empty or invalid.")
    first = detect_primary_markers(image)
    edges = [np.linalg.norm(first[(i + 1) % 4] - first[i]) for i in range(4)]
    ratio = ((edges[0] + edges[2]) / 2) / max(1e-6, (edges[1] + edges[3]) / 2)
    if ratio > 1.12:
        orientations = [
            (cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE), "rot90_cw"),
            (cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE), "rot90_ccw"),
        ]
    else:
        # Row-marker layout resolves the 0/180-degree ambiguity from geometry.
        orientations = [(image, "original"), (cv2.rotate(image, cv2.ROTATE_180), "rot180")]
    evaluated = []
    errors = []
    for working, orientation in orientations:
        try:
            src = detect_primary_markers(working)
            if src.shape != (4, 2) or not np.isfinite(src).all():
                raise RuntimeError("Invalid primary marker coordinates.")
            # Fixed A4/300-DPI coordinate system; primary markers alone define the homography.
            configure_geometry(2480, 3508)
            dst = MARKER_DST.astype(np.float32)
            Hmat = cv2.getPerspectiveTransform(src, dst)
            if not np.isfinite(Hmat).all() or abs(np.linalg.det(Hmat)) < 1e-12:
                raise RuntimeError("Invalid homography computed from primary markers.")
            warped = cv2.warpPerspective(
                working, Hmat, (W, H), flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
            if warped.shape[:2] != (H, W):
                raise RuntimeError(f"Rectified raster dimension error: {warped.shape[1]}x{warped.shape[0]}")
            mapped = cv2.perspectiveTransform(src.reshape(1, 4, 2), Hmat).reshape(4, 2)
            err = float(np.max(np.linalg.norm(mapped - dst, axis=1)))
            if err > 2.0:
                raise RuntimeError(f"Primary marker reprojection error too high: {err:.2f}px")
            # Validate orientation by alignment of secondary row markers to the
            # known template. If markers are unavailable, the nominal layout is
            # retained and the caller reports low local-marker confidence.
            try:
                _, report = refine_answer_rows(warped, ANSWER_Y)
                row_matches = report["row_matches"]
            except Exception:
                row_matches = 0
            evaluated.append((row_matches, orientation, warped, Hmat, src))
        except Exception as exc:
            errors.append(f"{orientation}: {exc}")
    if not evaluated:
        raise RuntimeError("Primary-marker rectification failed: " + " | ".join(errors))
    # Highest row-marker agreement wins. Ties prefer the first candidate.
    evaluated.sort(key=lambda item: item[0], reverse=True)
    matches, orientation, warped, Hmat, src = evaluated[0]
    # Restore coordinate scaling corresponding to the selected image (candidate
    # evaluation may have configured globals for a different orientation).
    configure_geometry(warped.shape[1], warped.shape[0])
    LOG.info("Rectification orientation=%s; fixed A4 raster=%sx%s; secondary row-marker matches=%s/15",
             orientation, warped.shape[1], warped.shape[0], matches)
    return warped, Hmat, src


def detect_secondary_markers(warped):
    """Detect small solid square markers in normalized coordinates for row refinement/diagnostics."""
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    # Adaptive threshold is tolerant of lighting gradients; restrict candidates to expected answer panel edges.
    bw = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY_INV, 31, 8)
    contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for c in contours:
        area = cv2.contourArea(c)
        if not 18 <= area <= 1500: continue
        peri = cv2.arcLength(c, True)
        if peri <= 0: continue
        ap = cv2.approxPolyDP(c, 0.08*peri, True)
        if len(ap) != 4 or not cv2.isContourConvex(ap): continue
        x,y,w,h = cv2.boundingRect(ap)
        if min(w,h) < 4 or max(w,h)/max(1,min(w,h)) > 1.45: continue
        if not 0.55 <= area / max(1, w*h) <= 1.15: continue
        m = cv2.moments(c)
        if abs(m['m00']) < 1e-6: continue
        found.append((m['m10']/m['m00'], m['m01']/m['m00'], w, h, area))
    return found


def refine_answer_rows(warped, nominal_y):
    """Refine nominal row centers using detected secondary solid squares next to each answer panel.

    A local fallback to the normalized template coordinates is used if a marker
    is missing; this never changes global homography or primary references.
    """
    markers = detect_secondary_markers(warped)
    ys = np.array(nominal_y, dtype=float)
    matched = 0
    # Match each expected row marker independently in a narrow x/y window.
    for j, y in enumerate(nominal_y):
        candidates = []
        for mx, my, mw, mh, area in markers:
            if any(abs(mx - ex) < X(11) for ex in ANSWER_MARKER_X) and abs(my - y) < Y(14):
                candidates.append((abs(my-y) + min(abs(mx-ex) for ex in ANSWER_MARKER_X)*0.05, my))
        if candidates:
            _, my = min(candidates)
            # Use a conservative blend to avoid a stray glyph shifting a whole row.
            if abs(my-y) <= Y(8): ys[j] = 0.75*y + 0.25*my; matched += 1
    return ys, {"detected": len(markers), "row_matches": matched, "row_expected": len(nominal_y)}


def bubble_metrics(gray, x, y, core_r=None, ann_r1=None, ann_r2=None):
    # Coordinates use the fixed marker-derived A4 raster, scaled from the template.
    # Sample the inner fill area while excluding the outline and printed glyph.
    scale = W / TEMPLATE_W
    if core_r is None: core_r = max(3, int(round(5.5 * scale)))
    if ann_r1 is None: ann_r1 = max(core_r + 2, int(round(13.5 * scale)))
    if ann_r2 is None: ann_r2 = max(ann_r1 + 2, int(round(18.5 * scale)) )
    h,w = gray.shape[:2]; x=int(round(x)); y=int(round(y))
    x0=max(0,x-ann_r2); x1=min(w,x+ann_r2+1); y0=max(0,y-ann_r2); y1=min(h,y+ann_r2+1)
    if x0>=x1 or y0>=y1: return 0.0, 0.0, 255.0
    yy,xx=np.ogrid[y0:y1,x0:x1]; d2=(xx-x)**2+(yy-y)**2; patch=gray[y0:y1,x0:x1]
    core=patch[d2<=core_r**2]; ann=patch[(d2>=ann_r1**2)&(d2<=ann_r2**2)]
    if core.size==0 or ann.size==0: return 0.0,0.0,255.0
    # Compare inner-disk darkness with local background. Filled bubbles have
    # high dark-pixel occupancy; printed choice letters are narrow and sparse.
    darkness=float(np.mean(ann)-np.mean(core))
    dark_fraction=float(np.mean(core < 125))
    mean=float(np.mean(core))
    return darkness, dark_fraction, mean


def mark_evidence(darkness, dark_fraction, core_mean, *, digit_grid=False):
    """Classify a bubble using local contrast and core occupancy.

    Digit-grid bubbles (student ID/exam code) contain no printed A/B/C/D glyph,
    so local contrast versus the surrounding paper is the strongest signal.
    Answer bubbles contain printed letters; there we require stronger dark-pixel
    occupancy to avoid mistaking the printed glyph for a pencil mark.
    """
    if digit_grid:
        # Pencil shading can be gray and may not cross a hard global threshold.
        # Require both a clear local contrast and a darker core than the paper.
        return darkness >= 24.0 and core_mean <= 180.0
    # Printed choice letters occupy only a small part of the bubble center. Use
    # a broader sampling disk (configured by read_answers) and require a larger
    # fraction of dark pixels so a printed B/D glyph alone is not mistaken for
    # a filled response. The higher mean cutoff still accepts ordinary pencil.
    return dark_fraction >= 0.30 and core_mean <= 180.0


def read_digit_grid(gray, xs, ys):
    scores=np.zeros((len(ys),len(xs)),float); evidence=np.zeros_like(scores,dtype=bool)
    for r,y in enumerate(ys):
        for c,x in enumerate(xs):
            d,t,m=bubble_metrics(gray,x,y); scores[r,c]=d; evidence[r,c]=mark_evidence(d,t,m,digit_grid=True)
    digits=[]; flags=[]
    for c in range(len(xs)):
        marked=np.where(evidence[:,c])[0]
        if len(marked)==0: digits.append(""); flags.append("BO_TRONG"); continue
        ranked=sorted(marked,key=lambda r:scores[r,c],reverse=True)
        if len(ranked)>1 and scores[ranked[1],c]>=12 and scores[ranked[0],c]-scores[ranked[1],c]<4:
            digits.append("?"); flags.append("TO_2_HOAC_NHIEU"); continue
        digits.append(str(int(ranked[0])))
        flags.append("OK" if scores[ranked[0],c]>=12 else "OK_NHAT")
    return "".join(digits), scores, flags


def read_answers(gray, row_y, num_questions=DEFAULT_QUESTIONS):
    """Read the first num_questions bubbles from the fixed 60-question template."""
    if not 1 <= int(num_questions) <= MAX_QUESTIONS:
        raise ValueError(f"num_questions must be between 1 and {MAX_QUESTIONS}")
    answers=[]; scores=np.zeros((int(num_questions),4),float); statuses=[]
    for q in range(int(num_questions)):
        panel=q//15; row=q%15; y=row_y[row]
        marked=[]
        for a,x in enumerate(ANSWER_X[panel]):
            d,t,m=bubble_metrics(gray,x,y,core_r=max(4,int(round(8.0*W/TEMPLATE_W)))); scores[q,a]=d
            if mark_evidence(d,t,m,digit_grid=False): marked.append(a)
        if not marked: answers.append(""); statuses.append("BO_TRONG")
        elif len(marked)>1:
            strong=[a for a in marked if scores[q,a]>=12]
            if len(strong)>1: answers.append("?"); statuses.append("TO_2_HOAC_NHIEU")
            else: answers.append(CHOICES[max(marked,key=lambda a:scores[q,a])]); statuses.append("OK_NHAT")
        else:
            a=marked[0]; answers.append(CHOICES[a]); statuses.append("OK" if scores[q,a]>=12 else "OK_NHAT")
    return answers,scores,statuses


def load_keys(path, num_questions=DEFAULT_QUESTIONS):
    data=json.loads(Path(path).read_text(encoding="utf-8")); keys={}
    num_questions = int(num_questions)
    if not 1 <= num_questions <= MAX_QUESTIONS:
        raise ValueError(f"num_questions must be between 1 and {MAX_QUESTIONS}")
    for code, arr in data.items():
        arr=[str(v).strip().upper() for v in arr]
        if len(arr)!=num_questions or any(v not in CHOICES for v in arr):
            raise ValueError(f"Exam code {code} must have exactly {num_questions} answers A/B/C/D for --num-questions {num_questions}")
        keys[str(code).zfill(2)]=arr
    return keys


def save_rectified(path, image):
    """Save the fixed-size normalized PNG with 300 DPI pHYs metadata."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if image.shape[1] != 2480 or image.shape[0] != 3508:
        raise ValueError(f"Refusing to save non-normalized image: {image.shape[1]}x{image.shape[0]}")
    ok, encoded = cv2.imencode(".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not ok:
        raise IOError("Could not encode rectified PNG")
    data = encoded.tobytes()
    # PNG pHYs stores pixels per meter. 300 DPI is 11811 pixels/meter.
    payload = struct.pack(">IIB", 11811, 11811, 1)
    chunk = struct.pack(">I", len(payload)) + b"pHYs" + payload
    chunk += struct.pack(">I", zlib.crc32(b"pHYs" + payload) & 0xffffffff)
    path.write_bytes(data[:33] + chunk + data[33:])


def debug_image(warped, answers, row_y, out_path, sid="", exam=""):
    img=warped.copy()
    # Draw only questions that are configured for this run; the sheet layout remains 60 bubbles.
    for q in range(len(answers)):
        panel=q//15; r=q%15; y=row_y[r]
        for x in ANSWER_X[panel]:
            cv2.circle(img,(int(x),int(y)),27,(255,0,0),3)
        cv2.putText(img,f"{q+1}:{answers[q] or '-'}",(int(ANSWER_X[panel][0])-30,int(y)-17),cv2.FONT_HERSHEY_SIMPLEX,0.38,(0,100,255),1,cv2.LINE_AA)
    for x,y in MARKER_DST: cv2.circle(img,(int(x),int(y)),24,(0,140,255),3)
    cv2.putText(img,f"SID:{sid or '-'} EXAM:{exam or '-'}",(60,70),cv2.FONT_HERSHEY_SIMPLEX,1.1,(0,0,255),2,cv2.LINE_AA)
    cv2.imwrite(str(out_path),img)


def main():
    ap=argparse.ArgumentParser(description="A4 portrait OMR grader with primary-marker homography and fixed rectified raster")
    ap.add_argument("--input",default="bai_lam",help="Folder of answer-sheet photos")
    ap.add_argument("--keys",default="dap_an_theo_ma_de.json",help="JSON answer keys by exam code")
    ap.add_argument("--output",default="ket_qua",help="Output folder")
    ap.add_argument("--num-questions", type=int, default=DEFAULT_QUESTIONS, help="Number of questions to grade from the fixed 60-question sheet (1-60; default 60)")
    ap.add_argument("--max-score",type=float,default=DEFAULT_MAX_SCORE,help=f"Maximum total score (default {DEFAULT_MAX_SCORE:g})")
    ap.add_argument("--no-keys",action="store_true",help="Run recognition without requiring an answer-key JSON")
    args=ap.parse_args()
    if not 1 <= args.num_questions <= MAX_QUESTIONS:
        ap.error(f"--num-questions must be between 1 and {MAX_QUESTIONS}")
    if not math.isfinite(args.max_score) or args.max_score <= 0:
        ap.error("--max-score must be a finite number greater than 0")
    logging.basicConfig(level=logging.INFO,format="%(levelname)s: %(message)s")
    inp=Path(args.input); out=Path(args.output); dbg=out/"anh_kiem_tra"; norm=out/"anh_da_hieu_chinh"
    inp.mkdir(parents=True,exist_ok=True); out.mkdir(parents=True,exist_ok=True); dbg.mkdir(parents=True,exist_ok=True); norm.mkdir(parents=True,exist_ok=True)
    keys={}
    if not args.no_keys:
        if not Path(args.keys).exists(): raise FileNotFoundError(f"Answer key file not found: {args.keys}. Use --no-keys to run recognition only.")
        keys=load_keys(args.keys, args.num_questions)
    files=sorted(p for p in inp.iterdir() if p.suffix.lower() in {".jpg",".jpeg",".png",".bmp",".tif",".tiff",".webp"})
    if not files: print(f"No input images found in {inp.resolve()}"); return
    rows=[]
    for p in files:
        row={"File":p.name}
        try:
            raw=cv2.imread(str(p),cv2.IMREAD_COLOR)
            if raw is None: raise ValueError("Cannot decode input image")
            if raw.ndim not in (2, 3) or min(raw.shape[:2]) < 100:
                raise ValueError(f"Input image dimensions are invalid or too small: {raw.shape}")
            LOG.info("%s: input dimensions=%sx%s", p.name, raw.shape[1], raw.shape[0])
            warped,Hmat,src=rectify_to_a4(raw)
            # All downstream coordinates use this marker-derived fixed A4 raster.
            if warped.shape[1] != 2480 or warped.shape[0] != 3508 or W != 2480 or H != 3508:
                raise RuntimeError(f"Fixed A4 raster geometry mismatch: got {warped.shape[1]}x{warped.shape[0]}, configured {W}x{H}")
            save_rectified(norm/f"{p.stem}_rectified.png",warped)
            gray=cv2.cvtColor(warped,cv2.COLOR_BGR2GRAY)
            sid,sid_scores,sid_flags=read_digit_grid(gray,SID_X,SID_Y)
            exam,exam_scores,exam_flags=read_digit_grid(gray,EXAM_X,EXAM_Y)
            row_y,marker_report=refine_answer_rows(warped,ANSWER_Y)
            answers,answer_scores,answer_status=read_answers(gray,row_y,args.num_questions)
            row.update({"Ma sinh vien":sid,"Ma de":exam,"Marker den":"4/4","Normalized":f"Marker-rectified {warped.shape[1]}x{warped.shape[0]} (A4, 300 DPI)",
                        "Marker phu phat hien":marker_report["detected"],"Marker phu refine hang":f'{marker_report["row_matches"]}/{marker_report["row_expected"]}'})
            checks=[i+1 for i,s in enumerate(answer_status) if s in ("BO_TRONG","TO_2_HOAC_NHIEU")]
            row["Can kiem tra"]="YES" if checks or len(sid)!=4 or "?" in sid or len(exam)!=2 or "?" in exam or any(s=="TO_2_HOAC_NHIEU" for s in exam_flags+sid_flags) else "NO"
            row["Cau can kiem tra"]=", ".join(f"C{i}" for i in checks) if checks else "KHONG"
            key=keys.get(exam)
            if keys and key is None:
                row.update({"Dung":"","Sai":"","Diem":"","Cau sai":"","Chi tiet cau sai":"","Loi":f"No answer key for exam code {exam or '(unreadable)'}"})
            elif key is not None:
                correct=sum(a==k for a,k in zip(answers,key))
                wrong=[i for i,(a,k) in enumerate(zip(answers,key),1) if a!=k]
                row["Dung"]=correct; row["Sai"]=args.num_questions-correct
                score=round(correct/args.num_questions*args.max_score,2)
                row["Diem"]=f"{score}*" if checks else score
                row["Cau sai"]=", ".join(f"C{i}" for i in wrong) if wrong else "KHONG SAI"
                row["Chi tiet cau sai"]="; ".join(f"C{i}: chon {answers[i-1] or 'BO_TRONG'}, dung {key[i-1]}" for i in wrong) if wrong else "KHONG SAI"
                row["Loi"]="; ".join(f"C{i+1}:{s}" for i,s in enumerate(answer_status) if s!="OK")
            else:
                row.update({"Dung":"","Sai":"","Diem":"","Cau sai":"","Chi tiet cau sai":"","Loi":"Recognition only; grading skipped (--no-keys)"})
            for i,a in enumerate(answers,1): row[f"C{i}"]=a
            debug_image(warped,answers,row_y,dbg/f"{p.stem}_kiemtra.jpg",sid,exam)
            LOG.info("%s SID=%s EXAM=%s raster=%sx%s marker=4/4 secondary=%s/%s",p.name,sid,exam,warped.shape[1],warped.shape[0],marker_report['row_matches'],marker_report['row_expected'])
        except Exception as exc:
            LOG.exception("Processing failed for %s",p.name)
            row.update({"Marker den":"ERROR","Normalized":"NO","Loi":str(exc),"Can kiem tra":"YES"})
        rows.append(row)
    # Deduplicate only fully identical output rows, preserving distinct submissions.
    unique=[]; seen=set()
    for r in rows:
        k=tuple(sorted((str(a),str(b)) for a,b in r.items()))
        if k not in seen: seen.add(k); unique.append(r)
    df=pd.DataFrame(unique); df.to_excel(out/"ket_qua_cham.xlsx",index=False); df.to_csv(out/"ket_qua_cham.csv",index=False,encoding="utf-8-sig")
    compact=pd.DataFrame([{"Ma sinh vien":r.get("Ma sinh vien",""),"Ma de":r.get("Ma de",""),"Sai":r.get("Sai",""),"Dung":r.get("Dung",""),"Diem tong":r.get("Diem","")} for r in unique],columns=["Ma sinh vien","Ma de","Sai","Dung","Diem tong"])
    compact.to_excel(out/"tong_diem.xlsx",index=False); compact.to_csv(out/"tong_diem.csv",index=False,encoding="utf-8-sig")
    print(f"Finished: {len(unique)} row(s). Results: {out.resolve()}")

if __name__=="__main__": main()
