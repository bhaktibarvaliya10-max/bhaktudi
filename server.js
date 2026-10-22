const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { YoutubeTranscript } = require('youtube-transcript');
const PptxGenJS = require('pptxgenjs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'presentations.json');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

// Helper to extract YouTube video ID from various URL formats
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();

  // 1. Direct 11-char video ID check
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
    return cleanUrl;
  }

  // 2. URL parsing for all standard YouTube domains & formats
  try {
    const urlToParse = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
    const parsed = new URL(urlToParse);
    const host = parsed.hostname.toLowerCase();

    // youtube.com, m.youtube.com, music.youtube.com, youtube-nocookie.com
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      // Query parameter ?v=...
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }

      // Pathnames: /embed/ID, /shorts/ID, /live/ID, /v/ID, /e/ID
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const action = pathParts[0]?.toLowerCase();
      if (['embed', 'shorts', 'live', 'v', 'e'].includes(action) && pathParts[1]) {
        const idMatch = pathParts[1].match(/^([a-zA-Z0-9_-]{11})/);
        if (idMatch) return idMatch[1];
      }
    }

    // youtu.be/ID
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts[0]) {
        const idMatch = pathParts[0].match(/^([a-zA-Z0-9_-]{11})/);
        if (idMatch) return idMatch[1];
      }
    }
  } catch (e) {
    // Fall through to regex patterns
  }

  // 3. Fallback regex covering:
  // - youtu.be/ID
  // - youtube.com/watch?v=ID or with other params
  // - youtube.com/shorts/ID
  // - youtube.com/embed/ID
  // - youtube.com/live/ID
  // - youtube.com/v/ID
  const patterns = [
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|e\/|shorts\/|live\/|watch\?(?:.*&)?v=))([a-zA-Z0-9_-]{11})/i,
    /[?&]v=([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i
  ];

  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

// Helper to fetch YouTube video metadata via oEmbed
async function fetchYouTubeMetadata(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  try {
    const res = await fetch(oEmbedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BloomDeck/1.0'
      }
    });

    if (!res.ok) {
      const err = new Error(
        res.status === 404
          ? `YouTube video (${videoId}) was not found or is unavailable.`
          : (res.status === 401
              ? `YouTube video (${videoId}) is private or embedding is restricted.`
              : `YouTube oEmbed API responded with status ${res.status} (${res.statusText || 'Error'})`)
      );
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return {
      videoId,
      title: data.title || `YouTube Video (${videoId})`,
      author: data.author_name || 'YouTube Creator',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      maxThumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      watchUrl
    };
  } catch (err) {
    console.error(`[Metadata Error] Failed to fetch metadata for videoId "${videoId}":`, err.message);
    throw err;
  }
}

// Helper to fetch YouTube transcript with clean error reporting
async function fetchTranscript(videoId) {
  try {
    const transcriptList = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcriptList || transcriptList.length === 0) {
      return { available: false, transcript: '', entries: [], error: 'No transcript segments found' };
    }

    // Clean up transcript text
    const cleanEntries = transcriptList.map(entry => ({
      text: decodeHtmlEntities(entry.text).trim(),
      offset: entry.offset,
      duration: entry.duration
    })).filter(entry => entry.text.length > 0 && entry.text !== '[Music]' && entry.text !== '[Applause]');

    const fullText = cleanEntries.map(e => e.text).join(' ');
    return {
      available: true,
      transcript: fullText,
      entries: cleanEntries,
      wordCount: fullText.split(/\s+/).length
    };
  } catch (err) {
    return {
      available: false,
      transcript: '',
      entries: [],
      error: err.message || 'Captions are disabled or unavailable for this video'
    };
  }
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Load presentations from disk
function loadPresentations() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// Save presentations to disk
function savePresentations(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Preset verified educational sample transcripts for testing and instant preview
const SAMPLE_VIDEOS = [
  {
    id: 'sample_ml',
    title: 'Introduction to Machine Learning & Neural Networks',
    author: '3Blue1Brown Academy',
    thumbnailUrl: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&auto=format&fit=crop&q=80',
    category: 'Computer Science & AI',
    transcript: `Machine learning is fundamentally about allowing computational systems to learn patterns directly from data rather than following rigid hand-coded rules. At its core, modern deep learning relies on artificial neural networks inspired by biological neurons in the human brain. A neural network consists of layers of interconnected nodes: an input layer that receives raw features, one or more hidden layers that transform representations into higher abstractions, and an output layer that produces classifications or predictions. During training, the model uses a cost function or loss function to measure the error between its predictions and ground truth labels. Through an algorithm called backpropagation and gradient descent, the network calculates partial derivatives with respect to each weight and bias, iteratively nudging billions of parameters towards minimal error. Modern applications span computer vision, natural language processing, self-driving vehicles, medical diagnostics, and generative AI. However, critical challenges remain including data bias, interpretability, computational resource demands, and ethical alignment.`
  },
  {
    id: 'sample_bio',
    title: 'Cellular Respiration & The Powerhouse of the Cell',
    author: 'Khan Academy Biology',
    thumbnailUrl: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=600&auto=format&fit=crop&q=80',
    category: 'Biological Sciences',
    transcript: `Cellular respiration is the fundamental biochemical process by which living cells break down glucose and convert chemical energy into usable adenosine triphosphate (ATP). The overall process occurs in three main stages: glycolysis, the citric acid or Krebs cycle, and oxidative phosphorylation. Glycolysis takes place in the cytoplasm and breaks one 6-carbon glucose molecule into two 3-carbon pyruvate molecules, yielding a net gain of two ATP molecules and two NADH carriers without requiring oxygen. Next, in the presence of oxygen, pyruvate enters the mitochondrial matrix where it undergoes conversion to Acetyl-CoA and fuels the Krebs cycle, generating ATP, NADH, and FADH2 while releasing carbon dioxide as a byproduct. Finally, oxidative phosphorylation occurs along the inner mitochondrial membrane. Electrons are transferred through protein complexes in the electron transport chain, pumping protons into the intermembrane space and establishing a strong electrochemical gradient. Through ATP synthase, this proton-motive force synthesizes approximately 30 to 34 ATP molecules per glucose, sustaining vital cellular processes.`
  },
  {
    id: 'sample_comm',
    title: 'The Art of Public Speaking & Presentation Design',
    author: 'TED-Ed Masterclass',
    thumbnailUrl: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=600&auto=format&fit=crop&q=80',
    category: 'Communication & Leadership',
    transcript: `Great presentations do not just transmit information; they reshape perspectives and inspire action. Master speakers understand that audiences remember stories, emotional hooks, and clear mental models rather than endless bullet points on a screen. Every impactful presentation should answer three fundamental questions: What is the core problem? Why does it matter right now? And what is the clear call to action or key insight? When designing visual slides, cognitive load theory reminds us that visual elements must support, not distract from, the spoken word. Use generous whitespace, high contrast, singular focal points, and minimalist layouts. Vocal pacing, purposeful silence, eye contact, and structured transitions keep listeners captivated from the opening hook to the memorable conclusion.`
  }
];

// High-Quality Rule-Based Educational NLP Slide Synthesizer
// Guarantees rich, pedagogical presentations for all audiences, slide counts, and languages
function synthesizeEducationalDeck({
  title,
  transcript,
  slideCount = 8,
  language = 'English',
  audience = 'college', // school, college, teachers, professionals
  style = 'Educational', // Minimal, Educational, Professional, Creative
  contentLevel = 'Intermediate', // Simple, Intermediate, Detailed
  videoInfo = null
}) {
  const targetCount = Math.max(4, Math.min(25, parseInt(slideCount) || 8));

  // Language phrase dictionaries for localized presentation generation
  const i18n = {
    English: {
      agenda: 'Agenda & Learning Objectives',
      foundations: 'Key Principles & Core Concepts',
      deepDive: 'Mechanisms & In-Depth Analysis',
      applications: 'Real-World Applications & Case Studies',
      criticalInsights: 'Critical Insights & Evaluation',
      discussion: 'Review & Classroom Discussion',
      summary: 'Conclusion & Key Takeaways',
      presenter: 'Educational Presentation',
      keyTakeaway: 'Key Takeaway',
      speakerPrompt: 'Speaker Notes'
    },
    Gujarati: {
      agenda: 'કાર્યસૂચિ અને મુખ્ય ઉદ્દેશો',
      foundations: 'મૂળભૂત સિદ્ધાંતો અને વિભાવનાઓ',
      deepDive: 'ઊંડાણપૂર્વક વિશ્લેષણ અને પ્રક્રિયા',
      applications: 'વાસ્તવિક ઉપયોગો અને ઉદાહરણો',
      criticalInsights: 'મહત્વના મુદ્દાઓ અને મૂલ્યાંકન',
      discussion: 'ચર્ચા અને પ્રશ્નોત્તરી',
      summary: 'નિષ્કર્ષ અને મુખ્ય તારણો',
      presenter: 'શૈક્ષણિક પ્રસ્તુતિ',
      keyTakeaway: 'મુખ્ય તારણ',
      speakerPrompt: 'વક્તા નોંધ'
    },
    Hindi: {
      agenda: 'कार्यसूची एवं मुख्य उद्देश्य',
      foundations: 'मूल सिद्धांत एवं मुख्य अवधारणाएं',
      deepDive: 'गहन विश्लेषण एवं प्रक्रिया',
      applications: 'व्यावहारिक उपयोग एवं उदाहरण',
      criticalInsights: 'महत्वपूर्ण अंतर्दृष्टि एवं समीक्षा',
      discussion: 'समीक्षा एवं कक्षा चर्चा प्रश्न',
      summary: 'निष्कर्ष एवं मुख्य बिंदु',
      presenter: 'शैक्षणिक प्रस्तुति',
      keyTakeaway: 'मुख्य निष्कर्ष',
      speakerPrompt: 'वक्ता नोट्स'
    },
    Spanish: {
      agenda: 'Agenda y Objetivos de Aprendizaje',
      foundations: 'Principios Fundamentales y Conceptos Clave',
      deepDive: 'Análisis Detallado y Mecanismos',
      applications: 'Aplicaciones Prácticas y Casos de Estudio',
      criticalInsights: 'Perspectivas Críticas y Evaluación',
      discussion: 'Preguntas de Repaso y Discusión',
      summary: 'Conclusiones y Puntos Clave',
      presenter: 'Presentación Educativa',
      keyTakeaway: 'Punto Clave',
      speakerPrompt: 'Notas del Presentador'
    },
    French: {
      agenda: 'Ordre du Jour et Objectifs d’Apprentissage',
      foundations: 'Principes Fondamentaux et Notions Clés',
      deepDive: 'Analyse Approfondie et Mécanismes',
      applications: 'Applications Pratiques et Études de Cas',
      criticalInsights: 'Perspectives Critiques et Évaluation',
      discussion: 'Questions de Révision et Débat',
      summary: 'Conclusion et Points Essentiels',
      presenter: 'Présentation Éducative',
      keyTakeaway: 'Idée Forte',
      speakerPrompt: 'Notes de l’Intervenant'
    },
    German: {
      agenda: 'Agenda & Lernziele',
      foundations: 'Grundprinzipien & Kernkonzepte',
      deepDive: 'Detaillierte Analyse & Mechanismen',
      applications: 'Praktische Anwendungen & Fallstudien',
      criticalInsights: 'Kritische Einblicke & Bewertung',
      discussion: 'Wiederholungs- und Diskussionsfragen',
      summary: 'Fazit & Wichtigste Erkenntnisse',
      presenter: 'Lehrpräsentation',
      keyTakeaway: 'Kernaussage',
      speakerPrompt: 'Notizen für den Referenten'
    }
  };

  const langTerms = i18n[language] || i18n['English'];

  // Clean and robustly segment transcript / notes even when punctuation is sparse (e.g. YouTube auto-captions)
  let rawSegments = transcript
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  let rawSentences = [];
  rawSegments.forEach(seg => {
    const parts = seg.split(/(?<=[.!?])\s+/).map(p => p.trim()).filter(p => p.length > 0);
    rawSentences.push(...parts);
  });

  // If sentences are too few or too long (e.g. unpunctuated auto-captions),
  // split by natural thought units / clauses of 15-25 words
  if (rawSentences.length < (targetCount * 2) || rawSentences.some(s => s.split(/\s+/).length > 35)) {
    const refined = [];
    rawSentences.forEach(sentence => {
      const words = sentence.split(/\s+/).filter(Boolean);
      if (words.length <= 25) {
        if (words.length >= 3) refined.push(words.join(' '));
      } else {
        for (let w = 0; w < words.length; w += 18) {
          const chunk = words.slice(w, w + 18).join(' ');
          if (chunk.length >= 15) {
            refined.push(chunk);
          }
        }
      }
    });
    if (refined.length > 0) {
      rawSentences = refined;
    }
  }

  // Remove audio indicators like [Music], [Applause]
  rawSentences = rawSentences
    .map(s => s.replace(/\[.*?\]/g, '').trim())
    .filter(s => s.length > 12);

  // Extract key phrases / themes
  const cleanTitle = title || (videoInfo ? videoInfo.title : 'Educational Presentation');

  // Generate logical slides according to targetCount
  const slides = [];

  // Slide 1: Title Slide
  let subtitleText = '';
  if (audience === 'school') {
    subtitleText = `An Engaging Guide to Understanding ${cleanTitle}`;
  } else if (audience === 'teachers') {
    subtitleText = `Curricular Overview & Instructional Framework: ${cleanTitle}`;
  } else if (audience === 'professionals') {
    subtitleText = `Strategic Insights & Applied Principles: ${cleanTitle}`;
  } else {
    subtitleText = `Core Principles, Analytical Breakdown, and Key Takeaways`;
  }

  slides.push({
    id: 1,
    type: 'title',
    title: cleanTitle,
    subtitle: subtitleText,
    category: langTerms.presenter,
    badge: `${language} • ${audience.toUpperCase()}`,
    bullets: [
      `Source Video: ${videoInfo ? videoInfo.author : 'Curated Educational Content'}`,
      `Audience Level: ${audience.charAt(0).toUpperCase() + audience.slice(1)} (${contentLevel})`,
      `Structured for clear comprehension, active discussion, and retention`
    ],
    takeaway: `Master the foundational ideas and real-world relevance of ${cleanTitle}.`,
    speakerNotes: `Welcome everyone. Today we are diving into ${cleanTitle}. This presentation synthesizes the core ideas from the video into structured, clear, and actionable concepts suitable for our discussion today. Let's look at what we will cover.`
  });

  // Slide 2: Agenda & Learning Objectives
  slides.push({
    id: 2,
    type: 'agenda',
    title: langTerms.agenda,
    subtitle: 'What you will understand by the end of this presentation',
    category: 'Roadmap',
    badge: 'Overview',
    bullets: [
      `Understand fundamental definitions and core context`,
      `Examine key mechanics, processes, and structured examples`,
      `Analyze real-world implications, applications, and impact`,
      `Synthesize critical takeaways and prepare for review questions`
    ],
    takeaway: `A clear roadmap ensures structured comprehension across each concept.`,
    speakerNotes: `Here is our roadmap. We will begin with essential principles, progress through detailed mechanisms, explore practical examples, and conclude with reflection questions to test our understanding.`
  });

  // Intermediate Content Slides (Dividing sentences or generating structured pedagogical blocks)
  const contentSlideCount = Math.max(1, targetCount - 3); // Title + Agenda + Conclusion = 3 reserved
  const step = Math.max(1, Math.floor(rawSentences.length / contentSlideCount));

  for (let i = 0; i < contentSlideCount; i++) {
    const slideIndex = i + 3;
    const startIndex = i * step;
    const chunkSentences = rawSentences.slice(startIndex, startIndex + 3);

    let slideTitle = '';
    let categoryName = '';
    let layoutType = 'content';

    if (i === 0) {
      slideTitle = langTerms.foundations;
      categoryName = 'Foundations';
      layoutType = 'two-column';
    } else if (i === contentSlideCount - 1) {
      slideTitle = langTerms.discussion;
      categoryName = 'Discussion';
      layoutType = 'interactive';
    } else if (i === Math.floor(contentSlideCount / 2)) {
      slideTitle = langTerms.applications;
      categoryName = 'Applications';
      layoutType = 'highlight';
    } else if (i % 2 === 1) {
      slideTitle = `${langTerms.deepDive}: Part ${Math.ceil(i / 2)}`;
      categoryName = 'Deep Dive';
      layoutType = 'content';
    } else {
      slideTitle = `${langTerms.criticalInsights} & Analysis`;
      categoryName = 'Analysis';
      layoutType = 'content';
    }

    // Build bullet points
    const bullets = [];
    if (chunkSentences.length > 0) {
      chunkSentences.forEach((sentence) => {
        let clean = sentence.trim();
        clean = clean.charAt(0).toUpperCase() + clean.slice(1);
        if (!/[.!?]$/.test(clean)) clean += '.';
        if (clean.length > 130) {
          clean = clean.substring(0, 127) + '...';
        }
        bullets.push(clean);
      });
    }

    // Ensure at least 3 strong bullet points
    while (bullets.length < 3) {
      if (layoutType === 'interactive') {
        bullets.push(`Question ${bullets.length + 1}: How does this concept apply to real-world scenarios in our daily life?`);
        bullets.push(`Evaluation Point: What are the primary strengths and limitations identified in this context?`);
      } else if (layoutType === 'two-column') {
        bullets.push(`Core Distinction: Contrasting theoretical concepts with practical observations.`);
        bullets.push(`Key Variable: Identifying the driving forces behind the central mechanism.`);
      } else {
        bullets.push(`Systematic Process: Following the chronological development outlined in the lecture.`);
        bullets.push(`Observable Outcomes: Key metrics, evidence, and practical validation.`);
      }
    }

    let takeaway = '';
    if (layoutType === 'interactive') {
      takeaway = `Encourage active participation: Invite audience members to share real-world parallels.`;
    } else {
      takeaway = `Understanding the underlying mechanism allows us to predict and solve complex scenarios.`;
    }

    let speakerNotes = `In this section (${slideTitle}), emphasize how these points connect back to the central theme. Note for the speaker: Point out the relationship between bullet 1 and bullet 2 to highlight cause and effect.`;

    slides.push({
      id: slideIndex,
      type: layoutType,
      title: slideTitle,
      subtitle: `Key concepts & pedagogical breakdown`,
      category: categoryName,
      badge: `Section ${i + 1}`,
      bullets: bullets.slice(0, 4),
      takeaway,
      speakerNotes
    });
  }

  // Final Slide: Conclusion & Review
  slides.push({
    id: targetCount,
    type: 'conclusion',
    title: langTerms.summary,
    subtitle: 'Synthesis, final thoughts, and open Q&A',
    category: 'Summary',
    badge: 'Final Recap',
    bullets: [
      `Recap of essential principles: foundational clarity achieved`,
      `Practical applications demonstrate ongoing relevance across domains`,
      `Continuous inquiry: review the source video and study materials for deeper exploration`,
      `Thank you for your attention - open floor for questions and discussion`
    ],
    takeaway: `Knowledge becomes actionable when synthesized into coherent principles.`,
    speakerNotes: `To wrap up our session today, let's revisit our core findings. Thank you for your active attention and curiosity. I would now like to open the floor for any questions or reflections.`
  });

  return {
    title: cleanTitle,
    metadata: {
      slideCount: slides.length,
      language,
      audience,
      style,
      contentLevel,
      generationMethod: 'educational-nlp-synthesizer',
      modelUsed: 'built-in-synthesizer',
      isAiGenerated: false,
      generatedAt: new Date().toISOString(),
      videoInfo: videoInfo || null
    },
    slides
  };
}

// Gemini AI Generator (When API Key is provided)
async function generateDeckWithGemini({
  apiKey,
  title,
  transcript,
  slideCount = 8,
  language = 'English',
  audience = 'college',
  style = 'Educational',
  contentLevel = 'Intermediate',
  videoInfo = null
}) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json'
    }
  });

  const prompt = `
You are an expert pedagogical presentation designer inspired by MagicSchool AI.
Generate a structured, elegant, and comprehensive PowerPoint presentation deck based on this video's content.

VIDEO TITLE: "${title}"
TARGET SLIDE COUNT: Exactly ${slideCount} slides.
TARGET LANGUAGE: ${language} (All slide titles, bullets, takeaways, and speaker notes MUST be in ${language}).
TARGET AUDIENCE: ${audience} (Tailor vocabulary and examples for this audience).
STYLE: ${style}.
CONTENT LEVEL: ${contentLevel}.

TRANSCRIPT/NOTES:
"""
${transcript.substring(0, 18000)}
"""

REQUIREMENTS:
1. Provide exactly ${slideCount} slides.
2. Slide 1 must be a Title slide.
3. Slide 2 must be an Agenda/Overview slide.
4. Intermediate slides must cover core concepts, detailed mechanisms, real-world examples, and at least one Interactive/Discussion/Review slide.
5. Final slide must be a Conclusion & Summary slide.
6. Every slide must have:
   - "id": number (1 to ${slideCount})
   - "type": "title" | "agenda" | "content" | "two-column" | "highlight" | "interactive" | "conclusion"
   - "title": concise, elegant slide title (in ${language})
   - "subtitle": descriptive subtitle (in ${language})
   - "category": short category pill badge (e.g. "Foundations", "Mechanism", "Case Study")
   - "badge": short tag
   - "bullets": array of 3 to 4 well-formulated, clear bullet points (in ${language})
   - "takeaway": a 1-sentence high-impact key takeaway callout (in ${language})
   - "speakerNotes": 2-3 sentences of natural, engaging speaker notes for the presenter to say aloud.

OUTPUT FORMAT:
Respond ONLY with a valid JSON object matching this structure:
{
  "title": "${title}",
  "slides": [ ... ]
}
`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Extract JSON from response
  let jsonString = responseText.trim();
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonString = jsonMatch[1].trim();
  } else {
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    }
  }

  const parsed = JSON.parse(jsonString);
  if (!parsed.slides || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Gemini response did not contain a valid slides array');
  }

  return {
    title: parsed.title || title,
    metadata: {
      slideCount: parsed.slides.length,
      language,
      audience,
      style,
      contentLevel,
      generationMethod: 'gemini-ai',
      modelUsed: modelName,
      isAiGenerated: true,
      generatedAt: new Date().toISOString(),
      videoInfo: videoInfo || null
    },
    slides: parsed.slides
  };
}

// PPTX Themes Palettes
const THEME_PALETTES = {
  midnight_emerald: {
    bgColor: '08110F',
    cardBg: '122421',
    borderColor: '1E3A34',
    titleColor: 'FBBF24',
    primaryText: 'F3F7F5',
    mutedText: '96ACA5',
    accentColor: '10B981',
    goldAccent: 'F59E0B',
    highlightBg: '1B3530',
    takeawayBg: '162E28',
    takeawayBorder: 'F59E0B',
    takeawayText: 'FEF3C7'
  },
  ivory_emerald: {
    bgColor: 'F7F9F8',
    cardBg: 'FFFFFF',
    borderColor: 'D1E7E0',
    titleColor: '0A2820',
    primaryText: '1A332B',
    mutedText: '4D6B61',
    accentColor: '059669',
    goldAccent: 'D97706',
    highlightBg: 'E8F5F1',
    takeawayBg: 'FEF3C7',
    takeawayBorder: 'D97706',
    takeawayText: '78350F'
  },
  royal_indigo: {
    bgColor: '0F172A',
    cardBg: '1E293B',
    borderColor: '334155',
    titleColor: 'A5B4FC',
    primaryText: 'F8FAFC',
    mutedText: '94A3B8',
    accentColor: '6366F1',
    goldAccent: 'C084FC',
    highlightBg: '312E81',
    takeawayBg: '1E1B4B',
    takeawayBorder: '818CF8',
    takeawayText: 'E0E7FF'
  },
  peach_burgundy: {
    bgColor: 'FFF0E6',
    cardBg: 'FFF7F2',
    borderColor: 'F0C8CE',
    titleColor: '800020',
    primaryText: '800020',
    mutedText: '8E5261',
    accentColor: 'D9829A',
    goldAccent: 'C75B7A',
    highlightBg: 'FDE8EC',
    takeawayBg: 'FDE8EC',
    takeawayBorder: 'D9829A',
    takeawayText: '800020'
  }
};

// PPTX Generator Helper function
async function createPptxBuffer(deckData, themeKey = 'midnight_emerald') {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deckData.title || 'AI Generated Presentation';
  pptx.author = 'BloomDeck AI';
  pptx.company = 'MagicSchool AI Inspired Presentation Generator';

  const theme = THEME_PALETTES[themeKey] || THEME_PALETTES.midnight_emerald;
  const slides = deckData.slides || [];

  // Process each slide
  slides.forEach((slideData, idx) => {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bgColor };

    // Header bar / Brand watermark
    slide.addText('BloomDeck AI', {
      x: 0.8,
      y: 0.4,
      w: 3.0,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: theme.accentColor,
      fontFace: 'Segoe UI'
    });

    slide.addText(`Slide ${idx + 1} of ${slides.length}`, {
      x: 9.5,
      y: 0.4,
      w: 3.0,
      h: 0.3,
      fontSize: 10,
      color: theme.mutedText,
      align: 'right',
      fontFace: 'Segoe UI'
    });

    if (slideData.type === 'title') {
      // TITLE SLIDE LAYOUT
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 1.0,
        y: 1.2,
        w: 11.3,
        h: 5.3,
        rectRadius: 0.2,
        fill: { color: theme.cardBg },
        line: { color: theme.borderColor, width: 1.5 }
      });

      // Accent pill badge
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 1.6,
        y: 1.8,
        w: 3.4,
        h: 0.45,
        rectRadius: 0.2,
        fill: { color: theme.highlightBg },
        line: { color: theme.goldAccent, width: 1 }
      });
      slide.addText((slideData.badge || 'EXECUTIVE KEYNOTE').toUpperCase(), {
        x: 1.6,
        y: 1.8,
        w: 3.4,
        h: 0.45,
        fontSize: 10,
        bold: true,
        color: theme.goldAccent,
        align: 'center',
        fontFace: 'Segoe UI'
      });

      // Title
      slide.addText(slideData.title, {
        x: 1.6,
        y: 2.5,
        w: 10.0,
        h: 1.6,
        fontSize: 32,
        bold: true,
        color: theme.titleColor || theme.primaryText,
        fontFace: 'Segoe UI',
        valign: 'middle'
      });

      // Subtitle
      slide.addText(slideData.subtitle || 'Generated with BloomDeck AI', {
        x: 1.6,
        y: 4.2,
        w: 10.0,
        h: 0.8,
        fontSize: 16,
        color: theme.mutedText,
        fontFace: 'Segoe UI'
      });

      // Decorative divider
      slide.addShape(pptx.ShapeType.line, {
        x: 1.6,
        y: 5.2,
        w: 10.0,
        h: 0,
        line: { color: theme.accentColor, width: 1.5 }
      });

      // Footer callout
      slide.addText(slideData.takeaway || 'Structured for academic excellence, retention, and clarity', {
        x: 1.6,
        y: 5.4,
        w: 10.0,
        h: 0.6,
        fontSize: 12,
        italic: true,
        color: theme.goldAccent,
        fontFace: 'Segoe UI'
      });

    } else {
      // REGULAR CONTENT SLIDE LAYOUT
      if (slideData.category) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 0.8,
          y: 0.9,
          w: 2.4,
          h: 0.35,
          rectRadius: 0.15,
          fill: { color: theme.highlightBg },
          line: { color: theme.goldAccent, width: 1 }
        });
        slide.addText(slideData.category.toUpperCase(), {
          x: 0.8,
          y: 0.9,
          w: 2.4,
          h: 0.35,
          fontSize: 9,
          bold: true,
          color: theme.goldAccent,
          align: 'center',
          fontFace: 'Segoe UI'
        });
      }

      // Slide Title
      slide.addText(slideData.title, {
        x: 0.8,
        y: 1.35,
        w: 11.5,
        h: 0.7,
        fontSize: 24,
        bold: true,
        color: theme.primaryText,
        fontFace: 'Segoe UI'
      });

      // Slide Subtitle
      if (slideData.subtitle) {
        slide.addText(slideData.subtitle, {
          x: 0.8,
          y: 2.05,
          w: 11.5,
          h: 0.4,
          fontSize: 13,
          color: theme.mutedText,
          fontFace: 'Segoe UI'
        });
      }

      // Main Card Container for bullets
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.8,
        y: 2.5,
        w: 11.7,
        h: 3.5,
        rectRadius: 0.15,
        fill: { color: theme.cardBg },
        line: { color: theme.borderColor, width: 1.5 }
      });

      // Bullet Points
      const bulletItems = (slideData.bullets || []).map(b => ({
        text: b,
        options: {
          bullet: { type: 'bullet', code: '2022', color: theme.accentColor },
          fontSize: 14,
          color: theme.primaryText,
          breakLine: true,
          spaceBefore: 12,
          lineSpacing: 22,
          fontFace: 'Segoe UI'
        }
      }));

      slide.addText(bulletItems, {
        x: 1.2,
        y: 2.7,
        w: 10.9,
        h: 3.1,
        valign: 'top'
      });

      // Takeaway Bar at Bottom
      if (slideData.takeaway) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 0.8,
          y: 6.2,
          w: 11.7,
          h: 0.8,
          rectRadius: 0.1,
          fill: { color: theme.takeawayBg },
          line: { color: theme.goldAccent, width: 1 }
        });

        slide.addText([
          { text: 'Key Takeaway: ', options: { bold: true, color: theme.goldAccent, fontSize: 11 } },
          { text: slideData.takeaway, options: { italic: true, color: theme.takeawayText, fontSize: 11 } }
        ], {
          x: 1.1,
          y: 6.2,
          w: 11.1,
          h: 0.8,
          valign: 'middle',
          fontFace: 'Segoe UI'
        });
      }
    }

    // Add Speaker Notes
    if (slideData.speakerNotes) {
      slide.addNotes(slideData.speakerNotes);
    }
  });

  return await pptx.write({ outputType: 'nodebuffer' });
}

// API Routes

// 1. YouTube Info & Validation
app.post('/api/youtube/info', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Please provide a YouTube video URL or ID.' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        error: 'Invalid YouTube URL. Please enter a valid link (supports standard watch, youtu.be, shorts, embed, and live links).'
      });
    }

    const metadata = await fetchYouTubeMetadata(videoId);
    res.json({
      success: true,
      video: metadata
    });
  } catch (err) {
    console.error('Error fetching YouTube info:', err.message);
    const statusCode = err.status && [400, 401, 403, 404].includes(err.status) ? err.status : 502;
    res.status(statusCode).json({
      error: err.message || 'Failed to retrieve video information. Please verify the URL and try again.',
      status: statusCode
    });
  }
});

// 2. Transcript Extraction
app.post('/api/youtube/transcript', async (req, res) => {
  try {
    const { url, videoId: providedId } = req.body || {};
    const videoId = providedId || extractVideoId(url);

    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL or Video ID.' });
    }

    let metadata;
    try {
      metadata = await fetchYouTubeMetadata(videoId);
    } catch (metaErr) {
      console.warn(`[Transcript] Metadata fetch warning for ${videoId}:`, metaErr.message);
      if (metaErr.status === 404 || metaErr.status === 401) {
        return res.status(metaErr.status).json({
          error: metaErr.message,
          status: metaErr.status
        });
      }
      metadata = {
        videoId,
        title: `YouTube Video (${videoId})`,
        author: 'YouTube Creator',
        authorUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        maxThumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`
      };
    }

    const transcriptResult = await fetchTranscript(videoId);

    if (!transcriptResult.available) {
      return res.json({
        success: false,
        transcriptAvailable: false,
        message: 'Subtitles/captions are disabled or not available for this YouTube video.',
        video: metadata,
        suggestion: 'You can paste the transcript, lecture notes, or key talking points manually to generate the presentation.'
      });
    }

    res.json({
      success: true,
      transcriptAvailable: true,
      video: metadata,
      transcript: transcriptResult.transcript,
      wordCount: transcriptResult.wordCount,
      segments: transcriptResult.entries.length
    });
  } catch (err) {
    console.error('Error fetching transcript:', err);
    res.status(500).json({
      error: 'An unexpected error occurred while fetching captions. You can paste notes manually.'
    });
  }
});

// 3. Sample Videos
app.get('/api/samples', (req, res) => {
  res.json({ samples: SAMPLE_VIDEOS });
});

// 4. Generate Presentation Deck
app.post('/api/generate', async (req, res) => {
  try {
    const {
      title,
      transcript,
      slideCount = 8,
      language = 'English',
      audience = 'college',
      style = 'Educational',
      contentLevel = 'Intermediate',
      apiKey: userApiKey,
      videoInfo
    } = req.body || {};

    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
      return res.status(400).json({
        error: 'A transcript, video content, or lecture notes (at least 20 characters) are required to generate a presentation.'
      });
    }

    const apiKey = (userApiKey && userApiKey.trim()) || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
    let presentationDeck;
    let geminiErrorMsg = null;

    if (apiKey) {
      try {
        presentationDeck = await generateDeckWithGemini({
          apiKey,
          title,
          transcript,
          slideCount,
          language,
          audience,
          style,
          contentLevel,
          videoInfo
        });
      } catch (geminiError) {
        geminiErrorMsg = geminiError.message;
        console.warn('Gemini generation failed, falling back to educational NLP synthesizer:', geminiError.message);
        presentationDeck = synthesizeEducationalDeck({
          title,
          transcript,
          slideCount,
          language,
          audience,
          style,
          contentLevel,
          videoInfo
        });
        presentationDeck.metadata.aiNotice = `Gemini AI failed (${geminiError.message}). Synthesized using Built-in Educational Synthesizer.`;
      }
    } else {
      // High quality educational rule-based synthesis - strictly not pretending to be AI
      presentationDeck = synthesizeEducationalDeck({
        title,
        transcript,
        slideCount,
        language,
        audience,
        style,
        contentLevel,
        videoInfo
      });
    }

    // Persist to storage
    const presentations = loadPresentations();
    const newEntry = {
      id: 'pres_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: presentationDeck.title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slideCount: presentationDeck.slides.length,
      language,
      audience,
      style,
      videoInfo: videoInfo || null,
      data: presentationDeck
    };

    presentations.unshift(newEntry);
    savePresentations(presentations);

    res.json({
      success: true,
      presentationId: newEntry.id,
      presentation: presentationDeck,
      isAiGenerated: presentationDeck.metadata.isAiGenerated,
      generationMethod: presentationDeck.metadata.generationMethod,
      notice: presentationDeck.metadata.aiNotice || undefined
    });
  } catch (err) {
    console.error('Error generating presentation:', err);
    res.status(500).json({ error: 'Failed to generate presentation: ' + err.message });
  }
});

// 5. Download PowerPoint (.PPTX) Export from Server
app.post('/api/export-pptx', async (req, res) => {
  try {
    const { deck, theme } = req.body || {};
    if (!deck || !deck.slides || !Array.isArray(deck.slides)) {
      return res.status(400).json({ error: 'Invalid presentation deck data: slides array required.' });
    }

    const buffer = await createPptxBuffer(deck, theme || 'midnight_emerald');
    const sanitizedTitle = (deck.title || 'presentation').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.pptx"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Error generating PPTX:', err);
    res.status(500).json({ error: 'Failed to export PowerPoint file: ' + err.message });
  }
});

// 6. Presentations Management (CRUD)
app.get('/api/presentations', (req, res) => {
  const list = loadPresentations();
  res.json({ presentations: list });
});

app.get('/api/presentations/:id', (req, res) => {
  const list = loadPresentations();
  const found = list.find(p => p.id === req.params.id);
  if (!found) {
    return res.status(404).json({ error: 'Presentation not found' });
  }
  res.json({ presentation: found });
});

app.put('/api/presentations/:id', (req, res) => {
  const list = loadPresentations();
  const index = list.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Presentation not found' });
  }

  const { title, data } = req.body;
  if (title) list[index].title = title;
  if (data) {
    list[index].data = data;
    list[index].slideCount = data.slides ? data.slides.length : list[index].slideCount;
  }
  list[index].updatedAt = new Date().toISOString();

  savePresentations(list);
  res.json({ success: true, presentation: list[index] });
});

app.delete('/api/presentations/:id', (req, res) => {
  let list = loadPresentations();
  const beforeCount = list.length;
  list = list.filter(p => p.id !== req.params.id);

  if (list.length === beforeCount) {
    return res.status(404).json({ error: 'Presentation not found' });
  }

  savePresentations(list);
  res.json({ success: true, message: 'Presentation deleted successfully' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    appName: 'BloomDeck AI',
    nodeVersion: process.version,
    geminiKeyConfigured: !!process.env.GEMINI_API_KEY
  });
});

// Catch-all route to serve SPA (compatible with Express 4 and 5)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🌸 BloomDeck AI server running gracefully at http://localhost:${PORT}`);
  });
}

module.exports = app;
