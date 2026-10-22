# 🌸 BloomDeck AI - Pedagogical Presentation Generator

> **Turn Any Video into a Beautiful Presentation.**
> An AI-powered presentation generation web app inspired by MagicSchool AI, built for students, teachers, college projects, and educational seminars.

---

## 🎨 Color Palette & Aesthetic

Designed with an ultra-premium executive dark mode aesthetic:
- **Background:** Deep obsidian slate & dark forest (`#08110F`)
- **Card Surfaces:** Luxurious dark forest glassmorphism (`#122421`)
- **Primary Text:** Crisp alabaster platinum (`#F3F7F5`)
- **Secondary Text:** Muted sage silver (`#96ACA5`)
- **Borders:** Subtle emerald glass tint (`rgba(16, 185, 129, 0.2)`)
- **Primary Action Buttons:** Radiant emerald gradient (`#10B981` → `#059669`) with luminous glow
- **Badges & Accent Highlights:** Champagne gold (`#F59E0B` / `#FBBF24`)
- **Theme Choices (Web & PPTX):**
  1. **Midnight Emerald & Champagne Gold** (Default Luxury Keynote)
  2. **Ivory Alabaster & Forest Emerald** (Clean Academic Light Mode)
  3. **Royal Indigo & Lilac Violet** (Modern AI & University)
  4. **Soft Peach & Deep Burgundy** (Warm Educational)

---

## 🚀 Key Features

1. **YouTube Video URL Processing**:
   - Supports any standard YouTube link (`youtube.com/watch?v=...`, `youtu.be/...`, shorts, embeds).
   - Extracts genuine video metadata (title, author, thumbnail) via YouTube oEmbed.
   - Extracts accurate spoken captions and transcripts using caption parsers.
   - **Graceful Fallback**: If a video creator disables captions, users receive clear guidance with an inline manual notes/transcript paste area.

2. **Pedagogical Slide Structuring**:
   - Inspired by MagicSchool AI and Bloom's Taxonomy.
   - Generates Title slide, Learning Objectives/Agenda, Foundational Concepts, Deep Dives, Real-World Applications, Classroom Review Questions, and Summary Takeaways.
   - Includes structured bullet points and **Speaker Notes** embedded into each slide.

3. **Customization Controls**:
   - Custom Presentation Title.
   - Slide count: 5, 8, 10, 15, or custom number.
   - Multi-language: English, Gujarati (ગુજરાતી), Hindi (हिंदी), Spanish, French, German.
   - Audience tiers: School Students, College Students, Teachers & Educators, Professionals.
   - Style: Educational, Minimal, Professional, Creative.
   - Content Level: Simple, Intermediate, Detailed.
   - Color Themes: Soft Peach & Burgundy, Rose Bloom, Classic Ivory.

4. **Interactive Pink Generate Button**:
   - Dusty rose pink (`#D9829A`) with white text.
   - Interactive hover with deep rose pink (`#C75B7A`), smooth enlargement (`scale(1.02)`), and glowing shadow effect.
   - Click loading animation with progressive 4-step generation status checklist.
   - Prevents duplicate clicks during generation.

5. **Presentation Workspace & Live Editing**:
   - 16:9 widescreen slide canvas.
   - Slide thumbnails navigation with instant switcher.
   - Real-time inline editing: Click slide title or bullet points to modify directly.
   - Add new slide, delete slide, reorder (Move Up / Down), and AI refine slide.
   - Collapsible Presenter Speaker Notes drawer.
   - Fullscreen slideshow mode (with keyboard arrow navigation & Escape key).

6. **Genuine PowerPoint (.PPTX) Export**:
   - Generates real, editable Microsoft PowerPoint files (`.pptx`) with real shapes, fonts, bullets, and speaker notes using `PptxGenJS`.
   - Export to PDF (browser print-optimized 16:9 slide layout).
   - Copy presentation outline as Markdown.

7. **My Presentations Dashboard**:
   - Persistent storage in `data/presentations.json` and browser `localStorage`.
   - View, reopen, edit, rename, delete, and re-download previously generated decks.

---

## 🛠️ Running Locally

1. **Install dependencies (already installed)**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   # or
   node server.js
   ```

3. **Open in browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

4. **Optional: Configure Gemini API Key**:
   - Copy `.env.example` to `.env` and set `GEMINI_API_KEY=your_key`, or enter it directly via the in-app **Settings** modal.
   - If no API key is provided, the application automatically uses its built-in Educational NLP Synthesizer.
