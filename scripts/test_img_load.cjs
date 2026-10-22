const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const UPLOADS_DIR = '/home/ababeel/.gemini/antigravity/brain/2c1ba33c-3d0f-4215-96a2-c524c9616822/.user_uploaded';

function getB64(filename) {
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error("Missing file:", filePath);
    return "";
  }
  return fs.readFileSync(filePath).toString('base64');
}

// Pre-load all uploaded screenshots
const IMGS = {
  headerBanner: getB64('media_1792494062047_6822eeaa.png'),
  plannerL5: getB64('media_1792495823052_c5aa8ffb.png'),
  plannerL46: getB64('media_1792495844832_a0ad1bb6.png'),
  woCapacityCards: getB64('media_1792495864837_a95e98f6.png'),
  woMonthlyPlan: getB64('media_1792493538882_4c4b3e2a.png'),
  woPageFull: getB64('media_1792492276103_6731fcca.png'),
  excelPicker: getB64('media_1792484153788_30dd1efe.png'),
  shiftRulesModal: getB64('media_1792485623175_2d504dff.png'),
  headcountColors: getB64('media_1792490377401_71174198.png'),
  headcountPlain: getB64('media_1792490354220_ca2b3988.png'),
  statusCards: getB64('media_1792491789435_41d20fea.png'),
  openWoBtn: getB64('media_1792492823436_822fb7ed.png'),
  riyadhBadge: getB64('media_1792492773121_a4616e35.png')
};

console.log("Images loaded successfully.");
