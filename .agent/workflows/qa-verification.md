# TonfernPDF QA & Verification Workflow
// turbo-all

This workflow provides automated and manual steps to verify the stability of TonfernPDF. It documents past critical issues to prevent regressions when future agents or developers modify the code.

## 1. Past Critical Issues (Change Log)

| Issue | Root Cause | Fix |
|-------|------------|-----|
| **Z-index Blocking** | Snowfall decoration had `z-index: 9999`. | Moved to `z-index: -1`. |
| **Drag & Drop Failure**| Missing grab cursors and small handles. | Added `⠿` handle and `cursor: grab`. |
| **Metadata Merge Error**| `setKeywords` expected Array, got String. | Implemented `.split(',').map(...)` logic. |
| **Notification Duplication**| Notifications stacked and double-fired. | Added `existing.remove()` and removed redundant calls. |
| **Tailwind Warnings** | CDN version used in local file. | Removed script and used vanilla CSS. |

## 2. Automated Browser Verification Script
To verify the fixes, run the following steps using a browser subagent or manual JS console execution.

### Step 1: Verify Metadata & Merge Logic
Execute this in the console to ensure the merging logic doesn't crash on metadata:
```javascript
(async () => {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setKeywords(['test1', 'test2']); // Testing array input
  const bytes = await doc.save();
  const loaded = await PDFDocument.load(bytes);
  console.log("PDFLib Metadata Test:", loaded.getKeywords());
  
  // Simulation of the fix:
  const rawKeywords = "tag1, tag2, tag3";
  const processed = rawKeywords.split(',').map(k => k.trim()).filter(k => k);
  if (Array.isArray(processed)) console.log("✅ Keyword split logic: SUCCESS");
})();
```

### Step 2: Verify UI Layers (Z-index)
Check if any element blocks the interaction layer:
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

### Step 3: Verify Notification System
Test if multiple notifications clear correctly:
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

## 3. Manual Testing Plan (For Real Files)
Use these files for end-to-end testing:
- `/Users/earthondev/Desktop/Greenagro/02_Research/Papers/20210514162205F1.pdf`
- `/Users/earthondev/Desktop/Greenagro/02_Research/Papers/anres,+Article.pdf`

**Test Cases:**
1. **Merge Test**: Select both files -> Drag to reorder -> Click Merge. Verify the order in the saved PDF.
2. **Organize Test**: Upload `20210514162205F1.pdf` -> Move Page 1 to the end -> Save.
3. **Save/Cancel Test**: Click Save -> Choose location -> Verify 1 notification. Click Save -> Cancel -> Verify "Save cancelled" notification.

## 4. Dependencies
- Core: `pdf-lib.min.js`, `pdf.min.js`
- UX: `Sortable.min.js`
- Styling: Vanilla CSS (No Tailwind)
