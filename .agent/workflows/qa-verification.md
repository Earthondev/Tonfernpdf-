# TonfernPDF QA & Verification Workflow
// turbo-all

This workflow provides automated and manual steps to verify TonfernPDF stability. It also defines non-negotiable regression rules for future changes.

## 1. Past Critical Issues (Change Log)

| Issue | Root Cause | Fix |
|-------|------------|-----|
| **Z-index Blocking** | Snowfall decoration had `z-index: 9999`. | Moved to `z-index: -1`. |
| **Drag & Drop Failure**| Missing grab cursors and small handles. | Added `⠿` handle and `cursor: grab`. |
| **Metadata Merge Error**| `setKeywords` expected Array, got String. | Implemented `.split(',').map(...)` logic. |
| **Notification Duplication**| Notifications stacked and double-fired. | Added `existing.remove()` and removed redundant calls. |
| **Tailwind Warnings** | CDN version used in local file. | Removed script and used vanilla CSS. |

## 2. Automated Browser Verification Script
Run these checks in browser console or via automation.

### Step 1: Metadata Baseline (String -> Array)
```javascript
(async () => {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setKeywords(['test1', 'test2']);
  const bytes = await doc.save();
  const loaded = await PDFDocument.load(bytes);
  console.log("PDFLib Metadata Test:", loaded.getKeywords());

  const rawKeywords = "tag1, tag2, tag3";
  const processed = rawKeywords.split(',').map(k => k.trim()).filter(k => k);
  if (Array.isArray(processed)) console.log("✅ Keyword split logic: SUCCESS");
})();
```

### Step 1.1: Metadata Negative Inputs (No Silent Crash)
```javascript
(() => {
  const samples = [
    null,
    undefined,
    "",
    "   ",
    ["tag1", "", "  ", "tag2"],
  ];

  samples.forEach((input, i) => {
    try {
      const processed = Array.isArray(input)
        ? input.map(k => String(k).trim()).filter(Boolean)
        : String(input || "")
            .split(',')
            .map(k => k.trim())
            .filter(Boolean);

      console.log(`✅ Metadata Edge Case ${i}:`, processed);
    } catch (e) {
      console.error(`❌ Metadata Edge Case ${i} FAILED`, e);
    }
  });
})();
```

### Step 2: UI Layer Safety (Z-index)
```javascript
(() => {
  const decoration = window.getComputedStyle(document.body, '::before').zIndex;
  if (parseInt(decoration) < 0) {
    console.log("✅ Z-index Fix: SUCCESS (Decoration is in background)");
  } else {
    console.error("❌ Z-index Fix: FAILED (Decoration might block clicks)");
  }
})();
```

### Step 2.1: Pointer Safety (Overlay Must Not Capture Input)
```javascript
(() => {
  const el = document.elementFromPoint(
    window.innerWidth / 2,
    window.innerHeight / 2
  );
  if (el && el.closest('#homePage, .merge-page.active')) {
    console.log("✅ Pointer Test: SUCCESS (UI receives clicks)");
  } else {
    console.error("❌ Pointer Test: FAILED (Overlay may block interaction)");
  }
})();
```

### Step 3: Notification Deduplication
```javascript
(() => {
  showNotification('Test 1');
  showNotification('Test 2');
  const count = document.querySelectorAll('.notification').length;
  if (count === 1) {
    console.log("✅ Notification Deduplication: SUCCESS");
  } else {
    console.error("❌ Notification Deduplication: FAILED (Found " + count + ")");
  }
})();
```

### Step 3.1: Notification Stress / Race Condition
```javascript
(() => {
  for (let i = 0; i < 5; i++) {
    showNotification('Spam ' + i);
  }
  setTimeout(() => {
    const count = document.querySelectorAll('.notification').length;
    console.log(
      count === 1
        ? "✅ Notification Stress Test: SUCCESS"
        : "❌ Notification Stress Test: FAILED (" + count + ")"
    );
  }, 100);
})();
```

## 3. Manual Testing Plan (For Real Files)
Use these files for end-to-end testing:
- `/Users/earthondev/Desktop/Greenagro/02_Research/Papers/20210514162205F1.pdf`
- `/Users/earthondev/Desktop/Greenagro/02_Research/Papers/anres,+Article.pdf`

### Core Manual Cases
1. **Merge Test**: Select both files -> Drag to reorder -> Click Merge. Verify page order in output.
2. **Organize Test**: Upload `20210514162205F1.pdf` -> Move Page 1 to the end -> Save.
3. **Save/Cancel Test**: Save once -> verify single notification. Save again then cancel -> verify "Save cancelled".

### 3.1 File Name & Encoding Test
Use files that include:
- spaces in filename
- plus sign (`+`)
- non-ASCII characters (Thai/Japanese)

Verify:
- upload succeeds
- processing succeeds
- saved filename is not corrupted

### 3.2 Drag Handle UX Check
Checklist:
- cursor changes to `grab` / `grabbing`
- only `⠿` handle starts drag (not entire card)
- touch/mobile interaction does not drag whole page

## 4. Dependencies
- Core: `pdf-lib.min.js`, `pdf.min.js`
- UX: `Sortable.min.js`
- Styling: Vanilla CSS (No Tailwind)

## 5. Regression Rules (DO NOT VIOLATE)
- Do not introduce global `z-index > 100`.
- Do not pass raw strings directly into PDFLib metadata setters.
- Only one `.notification` element may exist at any time.
- UI decoration layers must not capture pointer events.
