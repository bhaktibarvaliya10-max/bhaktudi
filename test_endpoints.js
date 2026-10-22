const http = require('http');
const app = require('./server');

const TEST_PORT = 3999;
let server;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let body = null;
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(buffer.toString('utf8'));
          } catch (e) {
            body = buffer.toString('utf8');
          }
        } else {
          body = buffer;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          buffer
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(data);
    }
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting BloomDeck AI Endpoint Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  server = app.listen(TEST_PORT);
  await new Promise(r => setTimeout(r, 500));

  try {
    // 1. Health check
    console.log('Testing 1: GET /api/health');
    const healthRes = await request('/api/health');
    assert(healthRes.statusCode === 200, 'Status is 200');
    assert(healthRes.body && healthRes.body.status === 'ok', 'Body status is ok');
    assert(healthRes.body.appName === 'BloomDeck AI', 'App name is BloomDeck AI');

    // 2. YouTube Info - Valid standard watch URL
    console.log('\nTesting 2A: POST /api/youtube/info (Standard watch URL)');
    const infoWatch = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    });
    assert(infoWatch.statusCode === 200, 'Status is 200');
    assert(infoWatch.body.success === true, 'Success is true');
    assert(infoWatch.body.video && infoWatch.body.video.videoId === 'dQw4w9WgXcQ', 'VideoId matches dQw4w9WgXcQ');
    assert(typeof infoWatch.body.video.title === 'string' && infoWatch.body.video.title.length > 0, 'Title is extracted');
    assert(typeof infoWatch.body.video.thumbnailUrl === 'string', 'Thumbnail URL is returned');

    // 2B. YouTube Info - youtu.be URL
    console.log('\nTesting 2B: POST /api/youtube/info (youtu.be short link)');
    const infoYoutu = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://youtu.be/dQw4w9WgXcQ?si=abcdef12345' }
    });
    assert(infoYoutu.statusCode === 200, 'Status is 200');
    assert(infoYoutu.body.video.videoId === 'dQw4w9WgXcQ', 'youtu.be videoId extracted correctly');

    // 2C. YouTube Info - Shorts URL
    console.log('\nTesting 2C: POST /api/youtube/info (Shorts URL)');
    const infoShorts = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }
    });
    assert(infoShorts.statusCode === 200, 'Status is 200');
    assert(infoShorts.body.video.videoId === 'dQw4w9WgXcQ', 'Shorts videoId extracted correctly');

    // 2D. YouTube Info - Live URL
    console.log('\nTesting 2D: POST /api/youtube/info (Live URL)');
    const infoLive = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share' }
    });
    assert(infoLive.statusCode === 200, 'Status is 200');
    assert(infoLive.body.video.videoId === 'dQw4w9WgXcQ', 'Live videoId extracted correctly');

    // 2E. YouTube Info - Embed URL
    console.log('\nTesting 2E: POST /api/youtube/info (Embed URL)');
    const infoEmbed = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }
    });
    assert(infoEmbed.statusCode === 200, 'Status is 200');
    assert(infoEmbed.body.video.videoId === 'dQw4w9WgXcQ', 'Embed videoId extracted correctly');

    // 2F. YouTube Info - Invalid URL
    console.log('\nTesting 2F: POST /api/youtube/info (Invalid URL)');
    const infoInvalid = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://not-a-youtube-url.com/something' }
    });
    assert(infoInvalid.statusCode === 400, 'Status is 400 Bad Request');
    assert(infoInvalid.body && infoInvalid.body.error, 'Contains meaningful error message');

    // 2G. YouTube Info - Inaccessible / non-existent video ID
    console.log('\nTesting 2G: POST /api/youtube/info (Non-existent video ID)');
    const infoNonExistent = await request('/api/youtube/info', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/watch?v=00000000000' }
    });
    assert(infoNonExistent.statusCode === 404 || infoNonExistent.statusCode === 502, 'Status is 404/502');
    assert(infoNonExistent.body && infoNonExistent.body.error, 'Returns real error without fake fallback');

    // 3. YouTube Transcript
    console.log('\nTesting 3: POST /api/youtube/transcript');
    const transcriptRes = await request('/api/youtube/transcript', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    });
    assert(transcriptRes.statusCode === 200, 'Status is 200');
    assert(typeof transcriptRes.body.transcriptAvailable === 'boolean', 'transcriptAvailable is boolean');
    if (transcriptRes.body.transcriptAvailable) {
      assert(transcriptRes.body.transcript.length > 0, 'Transcript text is non-empty');
      assert(transcriptRes.body.wordCount > 0, 'Word count > 0');
    } else {
      assert(typeof transcriptRes.body.suggestion === 'string', 'Manual fallback suggestion is provided');
    }

    // 4. Generate Presentation
    console.log('\nTesting 4: POST /api/generate');
    const sampleNotes = `Artificial neural networks are computational models inspired by the human brain.
They consist of input, hidden, and output layers of interconnected neurons.
Backpropagation and gradient descent iteratively optimize weights based on loss calculation.
Applications span computer vision, speech recognition, natural language processing, and medical diagnosis.
Challenges include interpretability, computational resource constraints, and data bias.`;

    const genRes = await request('/api/generate', {
      method: 'POST',
      body: {
        title: 'Deep Learning & Neural Networks',
        transcript: sampleNotes,
        slideCount: 6,
        language: 'English',
        audience: 'college',
        style: 'Educational'
      }
    });
    assert(genRes.statusCode === 200, 'Status is 200');
    assert(genRes.body.success === true, 'Success is true');
    assert(genRes.body.presentation && genRes.body.presentation.slides, 'Presentation has slides');
    assert(genRes.body.presentation.slides.length === 6, 'Slide count is exactly 6');
    assert(genRes.body.isAiGenerated === false, 'isAiGenerated is correctly false (not pretending to be AI)');
    assert(genRes.body.generationMethod === 'educational-nlp-synthesizer', 'generationMethod is educational-nlp-synthesizer');

    // Verify slide contents
    const slides = genRes.body.presentation.slides;
    assert(slides[0].type === 'title', 'Slide 1 is title slide');
    assert(slides[1].type === 'agenda', 'Slide 2 is agenda slide');
    assert(slides[slides.length - 1].type === 'conclusion', 'Last slide is conclusion slide');
    assert(slides[2].bullets && slides[2].bullets.length >= 3, 'Content slide has at least 3 bullets');
    assert(typeof slides[2].takeaway === 'string' && slides[2].takeaway.length > 0, 'Content slide has takeaway');
    assert(typeof slides[2].speakerNotes === 'string' && slides[2].speakerNotes.length > 0, 'Content slide has speaker notes');

    // 5. Export PPTX
    console.log('\nTesting 5: POST /api/export-pptx');
    const exportRes = await request('/api/export-pptx', {
      method: 'POST',
      body: {
        deck: genRes.body.presentation,
        theme: 'midnight_emerald'
      }
    });
    assert(exportRes.statusCode === 200, 'Status is 200');
    assert(
      exportRes.headers['content-type'].includes('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      'Content-Type is PowerPoint presentationml'
    );
    assert(
      exportRes.headers['content-disposition'].includes('.pptx'),
      'Content-Disposition specifies .pptx file'
    );
    assert(exportRes.buffer.length > 10000, `PPTX buffer length (${exportRes.buffer.length} bytes) > 10KB`);

    // Verify ZIP magic bytes (PK\x03\x04)
    const isZip = exportRes.buffer[0] === 0x50 && exportRes.buffer[1] === 0x4B && exportRes.buffer[2] === 0x03 && exportRes.buffer[3] === 0x04;
    assert(isZip, 'Binary starts with PK ZIP header (valid openxml .pptx container)');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    console.log(`\n========================================`);
    console.log(`Test Summary: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
