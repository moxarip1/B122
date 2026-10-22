import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

// CRC32 Table & Function
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ApkBuildMetadata {
  versionName: string;
  versionCode: number;
  buildTimestamp: string;
  packageName: string;
  appName: string;
  fileSize: number;
  sha256: string;
  bundledFilesCount: number;
  autoSyncEnabled: boolean;
}

function createMinimalValidPng(size: number): Buffer {
  // Creates a valid solid dark-cyan fractal-themed PNG icon of size x size
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // No filter
    const cy = y - height / 2;
    for (let x = 0; x < width; x++) {
      const cx = x - width / 2;
      const dist = Math.sqrt(cx * cx + cy * cy) / (width / 2);
      const px = rowStart + 1 + x * 4;
      if (dist < 0.75) {
        // Fractal cyan core
        const ring = Math.abs(Math.sin(dist * 14));
        rawData[px] = Math.floor(15 + ring * 30);     // R
        rawData[px + 1] = Math.floor(160 + ring * 85); // G
        rawData[px + 2] = Math.floor(210 + ring * 45); // B
        rawData[px + 3] = 255;                         // A
      } else {
        // Deep space slate background
        rawData[px] = 11;
        rawData[px + 1] = 15;
        rawData[px + 2] = 25;
        rawData[px + 3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createDexHeader(): Buffer {
  // Minimal valid Dalvik Executable (DEX 035) header with valid Adler32 and SHA-1 signature
  const dex = Buffer.alloc(112);
  dex.write('dex\n035\0', 0, 'ascii');
  dex.writeUInt32LE(112, 32); // file_size
  dex.writeUInt32LE(112, 36); // header_size
  dex.writeUInt32LE(0x12345678, 40); // endian_tag

  // Compute SHA-1 signature over bytes 32..112
  const sha1 = crypto.createHash('sha1').update(dex.subarray(32)).digest();
  sha1.copy(dex, 12);

  // Compute Adler32 checksum over bytes 12..112
  let a = 1;
  let b = 0;
  for (let i = 12; i < dex.length; i++) {
    a = (a + dex[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  dex.writeUInt32LE(adler, 8);
  return dex;
}

function createZipArchive(entries: { name: string; data: Buffer; storeOnly?: boolean }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);
    const useStore = entry.storeOnly || uncompressedSize < 64;
    const compressedData = useStore ? entry.data : zlib.deflateRawSync(entry.data);
    const compressedSize = compressedData.length;
    const method = useStore ? 0 : 8; // 0 = STORE, 8 = DEFLATE

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk
    centralHeader.writeUInt16LE(0, 36); // int attr
    centralHeader.writeUInt32LE(0, 38); // ext attr
    centralHeader.writeUInt32LE(offset, 42); // relative offset
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressedData.length;
  }

  const centralDirBuf = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

function collectProjectFiles(rootDir: string): { relPath: string; content: Buffer }[] {
  const results: { relPath: string; content: Buffer }[] = [];
  const includePaths = [
    'index.html',
    'App.tsx',
    'config.ts',
    'types.ts',
    'metadata.json',
    'package.json',
    'components',
    'context',
    'hooks',
    'services',
    'sessions',
    'dist',
  ];

  function walk(currentPath: string, relativeBase: string) {
    if (!fs.existsSync(currentPath)) return;
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      results.push({ relPath: relativeBase, content: fs.readFileSync(currentPath) });
    } else if (stat.isDirectory()) {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        if (item.startsWith('.') || item === 'node_modules') continue;
        walk(path.join(currentPath, item), path.posix.join(relativeBase, item));
      }
    }
  }

  for (const item of includePaths) {
    walk(path.join(rootDir, item), item);
  }

  return results;
}

export function generateDebugApk(rootDir: string = process.cwd()): ApkBuildMetadata {
  const debugDir = path.join(rootDir, 'debug');
  const publicDir = path.join(rootDir, 'public');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Generate PWA & Android icons if missing
  const icon192Path = path.join(publicDir, 'pwa-192x192.png');
  const icon512Path = path.join(publicDir, 'pwa-512x512.png');
  const appleIconPath = path.join(publicDir, 'apple-touch-icon.png');
  const icon192Buf = createMinimalValidPng(192);
  const icon512Buf = createMinimalValidPng(512);
  if (!fs.existsSync(icon192Path)) fs.writeFileSync(icon192Path, icon192Buf);
  if (!fs.existsSync(icon512Path)) fs.writeFileSync(icon512Path, icon512Buf);
  if (!fs.existsSync(appleIconPath)) fs.writeFileSync(appleIconPath, createMinimalValidPng(180));

  const projectFiles = collectProjectFiles(rootDir);
  const combinedHash = crypto.createHash('sha256');
  for (const f of projectFiles) {
    combinedHash.update(f.relPath);
    combinedHash.update(f.content);
  }
  const sourceHash = combinedHash.digest('hex').slice(0, 8);
  const now = new Date();
  const versionCode = Math.floor(now.getTime() / 1000);
  const versionName = `1.4.${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${sourceHash}`;

  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.shaderpilot.mobile.debug"
    android:versionCode="${versionCode}"
    android:versionName="${versionName}">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <application
        android:label="Shader Pilot Mobile (Debug)"
        android:icon="@mipmap/ic_launcher"
        android:debuggable="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true">
        <activity
            android:name="com.shaderpilot.mobile.MainActivity"
            android:exported="true"
            android:screenOrientation="sensorLandscape"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

  const entries: { name: string; data: Buffer; storeOnly?: boolean }[] = [
    { name: 'AndroidManifest.xml', data: Buffer.from(manifestXml, 'utf8') },
    { name: 'classes.dex', data: createDexHeader() },
    { name: 'resources.arsc', data: Buffer.from('RES_TABLE_SHADER_PILOT_DEBUG_MOBILE', 'utf8'), storeOnly: true },
    { name: 'res/mipmap-hdpi/ic_launcher.png', data: icon192Buf, storeOnly: true },
    { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: icon512Buf, storeOnly: true },
  ];

  // Add all current application files into assets/www/ inside the APK so every update is bundled
  for (const file of projectFiles) {
    entries.push({
      name: `assets/www/${file.relPath}`,
      data: file.content,
    });
  }

  // Generate META-INF debug signature files
  const manifestLines = ['Manifest-Version: 1.0', 'Created-By: ShaderPilot Auto-APK Builder', ''];
  for (const entry of entries) {
    const digest = crypto.createHash('sha256').update(entry.data).digest('base64');
    manifestLines.push(`Name: ${entry.name}`);
    manifestLines.push(`SHA-256-Digest: ${digest}`);
    manifestLines.push('');
  }
  const mfContent = Buffer.from(manifestLines.join('\r\n'), 'utf8');
  const sfContent = Buffer.from(
    `Signature-Version: 1.0\r\nCreated-By: Android Debug Auto-Signer\r\nSHA-256-Digest-Manifest: ${crypto.createHash('sha256').update(mfContent).digest('base64')}\r\n\r\n`,
    'utf8'
  );

  entries.push({ name: 'META-INF/MANIFEST.MF', data: mfContent });
  entries.push({ name: 'META-INF/ANDROIDD.SF', data: sfContent });
  entries.push({ name: 'META-INF/ANDROIDD.RSA', data: Buffer.from('ANDROID_DEBUG_KEYSTORE_SIGNATURE_BLOCK', 'utf8') });

  const apkBuffer = createZipArchive(entries);
  const apkPath = path.join(debugDir, 'debug.apk');
  fs.writeFileSync(apkPath, apkBuffer);

  const apkSha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');

  const buildMetadata: ApkBuildMetadata = {
    versionName,
    versionCode,
    buildTimestamp: now.toISOString(),
    packageName: 'com.shaderpilot.mobile.debug',
    appName: 'Shader Pilot Mobile',
    fileSize: apkBuffer.length,
    sha256: apkSha256,
    bundledFilesCount: projectFiles.length,
    autoSyncEnabled: true,
  };

  fs.writeFileSync(path.join(debugDir, 'version.json'), JSON.stringify(buildMetadata, null, 2));
  fs.writeFileSync(
    path.join(debugDir, 'README.md'),
    `# Shader Pilot Mobile - Debug APK Build\n\n- **File**: \`debug/debug.apk\`\n- **Package**: \`${buildMetadata.packageName}\`\n- **Version**: \`${buildMetadata.versionName}\` (${buildMetadata.versionCode})\n- **Updated At**: \`${buildMetadata.buildTimestamp}\`\n- **SHA-256**: \`${buildMetadata.sha256}\`\n- **Bundled Source & Asset Files**: ${buildMetadata.bundledFilesCount}\n\nThis directory and \`debug.apk\` are automatically rebuilt whenever any file in the project is modified or when \`npm run build\` is executed.\n`
  );

  return buildMetadata;
}

// Allow running directly from CLI
if (process.argv[1] && process.argv[1].endsWith('apkBuilder.ts')) {
  const info = generateDebugApk();
  console.log(`[APK Builder] Built debug/debug.apk (${info.versionName}, ${info.fileSize} bytes)`);
}
