import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './GuidePage.module.css'

const SECTIONS = [
  { id: 'what',      label: 'What is Headspace?' },
  { id: 'diary',     label: 'The Diary' },
  { id: 'allentries',label: 'All Entries' },
  { id: 'tags',      label: 'Tags' },
  { id: 'objects',   label: 'Objects' },
  { id: 'linking',   label: 'Linking with @' },
  { id: 'backlinks', label: 'Backlinks' },
  { id: 'search',    label: 'Search' },
  { id: 'timer',     label: 'Timer' },
  { id: 'extension', label: 'Chrome Extension' },
  { id: 'export',    label: 'Export and Backup' },
  { id: 'tips',      label: 'Tips and Workflow' },
  { id: 'credits',   label: 'Credits' },
]

export default function GuidePage({ embedded = false }) {
  const navigate  = useNavigate()
  const [active, setActive] = useState('what')

  const scrollTo = (id) => {
    setActive(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={styles.page}>

      {/* Left: section nav (desktop only) */}
      <nav className={styles.toc} style={embedded ? {display:'none'} : {}}>
        <div className={styles.tocTitle}>Contents</div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`${styles.tocItem} ${active === s.id ? styles.tocActive : ''}`}
            onClick={() => scrollTo(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Right: content */}
      <div className={styles.content}>

        <div className={styles.heroRow}>
          <span className={styles.heroLogo}>H</span>
          <div>
            <h1 className={styles.heroTitle}>Getting Started with Headspace</h1>
            <p className={styles.heroSub}>Your self-hosted personal knowledge and diary — no cloud, no lock-in, just your thoughts.</p>
          </div>
        </div>

        <Section id="what" title="What is Headspace?">
          <p>Headspace is a self-hosted personal knowledge management app and diary. All your data lives on your own server or computer — no third-party cloud, no vendor account required.</p>
          <p>Everything is stored as plain Markdown and JSON files, so you can read, back up, and sync your notes with any tool you like.</p>
          <Callout icon="💡">Think of Headspace as your calm private studio — a place to write daily notes, tag thoughts, connect ideas, and build a personal knowledge graph over time.</Callout>
          <FeatureGrid features={[
            { icon:'📅', title:'Diary', desc:'Write daily notes anchored to a calendar. Multiple entries per day, all on one page.' },
            { icon:'📋', title:'All Entries', desc:'See every diary entry ever written in one chronological feed. Filter by tag.' },
            { icon:'🏷️', title:'Tags', desc:'Type #tagname anywhere in a diary entry to tag it. Manage, rename, and delete tags globally.' },
            { icon:'🧩', title:'Objects', desc:'People, places, ideas, organizations, and media — each with their own page, notes, and backlinks.' },
            { icon:'🔗', title:'Linking', desc:'Type @ anywhere to link diary entries to objects. Links are bidirectional — backlinks appear automatically.' },
            { icon:'🔍', title:'Search', desc:'Full-text search across everything — diary entries and all objects.' },
            { icon:'💾', title:'Export', desc:'Auto-backup and manual export. Import from Capacities JSON exports too.' },
          ]} />
        </Section>

        <Section id="diary" title="The Diary">
          <p>The Diary is the default home screen. It shows a <strong>week strip</strong> at the top — click any day to jump to it. The selected day shows all entries written on that date.</p>
          <StepList steps={[
            { n:1, title:'Navigate to any date', desc:'Click a day in the week strip, use the left/right arrows to move week by week, or click the calendar icon to open a full month picker.' },
            { n:2, title:'Add a Daily Note', desc:'Click the dashed \"+ Daily Note\" button at the bottom of the entries list. A new entry opens in editing mode.' },
            { n:3, title:'Use a template', desc:'Click the Templates button in the editor toolbar to insert a starter structure — Daily Reflection, Meeting Notes, or Idea Capture.' },
            { n:4, title:'Edit the timestamp', desc:'Click the clock icon (🕐) in the editor toolbar to change when an entry was written. Useful when writing retroactively.' },
            { n:5, title:'Write freely', desc:'Type anything. Link objects with @, add tags with #. Click Done to close the editor.' },
          ]} />
          <Callout icon="📅">
            The green day name at the top of the content area tells you which day you are viewing. The "Today" button in the week strip takes you back instantly.
          </Callout>
        </Section>

        <Section id="allentries" title="All Entries">
          <p>The <strong>All Entries</strong> page (second item in the sidebar) shows every diary entry you have ever written, sorted by date — newest first.</p>
          <ul className={styles.list}>
            <li>Entries are grouped by date with a green date header</li>
            <li>Click any entry to open it in the inline editor</li>
            <li>Tag filter chips appear at the top — click a tag to filter the entire feed to entries with that tag</li>
            <li>The entry count is shown next to the page title</li>
          </ul>
          <Callout icon="📋">
            All Entries is ideal for weekly reviews — scroll through the past week to see everything you wrote in one continuous feed.
          </Callout>
        </Section>

        <Section id="tags" title="Tags">
          <p>Tags let you categorise diary entries without creating a formal object. Type <code>#tagname</code> anywhere while writing — the tag is auto-detected when you save and appears as a teal pill below the editor.</p>
          <StepList steps={[
            { n:1, title:'Add a tag', desc:'While writing in any diary entry, type #yourtagname (no space after #). Tags are detected automatically on save.' },
            { n:2, title:'Filter by tag', desc:'On the Diary page or All Entries page, click a tag pill on any entry to filter the view. On the All Entries page, tag filter chips appear at the top.' },
            { n:3, title:'Manage tags', desc:'Go to the Tags page (tag icon in the sidebar). You will see every tag with a count of how many diary entries and objects use it.' },
            { n:4, title:'Rename globally', desc:'Click the pencil icon next to any tag, type the new name, and press Enter. Every entry and object using the old name is updated instantly.' },
            { n:5, title:'Delete globally', desc:'Click the trash icon next to any tag and confirm. The tag is removed from every entry and object.' },
          ]} />
          <Callout icon="🏷️">
            Tags are lowercase and stored without the # symbol. Writing #Learning and #learning both create the same tag.
          </Callout>
        </Section>

        <Section id="objects" title="Objects">
          <p>Objects are the building blocks of your knowledge graph. Every person, place, idea, organization, or piece of media you want to remember gets its own object page.</p>
          <p>There are five built-in object types:</p>
          <TypeGrid types={[
            { emoji:'👤', name:'Person',       desc:'Someone you know, have met, or want to remember — friends, colleagues, authors, historical figures.' },
            { emoji:'📍', name:'Place',        desc:'Locations you have been to or want to visit — cities, restaurants, venues, countries.' },
            { emoji:'💡', name:'Idea',         desc:'Concepts, projects, topics, or anything that doesn\'t fit neatly elsewhere.' },
            { emoji:'🏢', name:'Organization', desc:'Companies, institutions, communities, or groups.' },
            { emoji:'🎬', name:'Media',        desc:'Books, films, podcasts, articles, albums — anything you are consuming or have consumed.' },
            { emoji:'📄', name:'Page',         desc:'A general-purpose free-form page. Use it for reference notes, how-to guides, recurring checklists, or anything that does not fit the other types.' },
          ]} />
          <StepList steps={[
            { n:1, title:'Create an object', desc:'Go to the Objects tab. Click "New". Choose a type — Person, Place, Idea, Organization, Media, or Page — enter a name, and click Create.' },
            { n:2, title:'Write notes', desc:'On the object\'s page, click the notes area and type. You can use @ here to link this object to others.' },
            { n:3, title:'Merge duplicates', desc:'Accidentally created "Riyan" and "Riyan Hoq" separately? Click the Merge button on either object\'s page, search for the target, and confirm. All backlinks transfer to the surviving object.' },
            { n:4, title:'See where it\'s mentioned', desc:'Scroll to the Backlinks section at the bottom of the object page. Every diary entry or object note that mentions this object is listed there.' },
          ]} />
          <Callout icon="🔗">
            You don't have to go to the Objects tab to create a new object. Type @NewName in any diary entry or object notes and you'll see a "Create" option with a type picker — including Media — right in the popup.
          </Callout>
        </Section>

        <Section id="linking" title="Linking with @">
          <p>Linking is the most powerful feature in Headspace. Any diary entry or object note can reference any object using the @ symbol.</p>
          <CodeBlock>
{`Today I had lunch with @Riyan Hoq at @Cafe Aalto.
We discussed @Headspace and the #product roadmap.`}
          </CodeBlock>
          <p>When you type <code>@</code>, a search popup appears immediately. You can:</p>
          <ul className={styles.list}>
            <li>Type letters to filter — spaces are allowed, so "Riyan Ho" finds "Riyan Hoq"</li>
            <li>Use <kbd>↑</kbd> <kbd>↓</kbd> arrow keys to navigate results</li>
            <li>Press <kbd>Enter</kbd> to select the highlighted result</li>
            <li>Click any result with the mouse</li>
            <li>Press <kbd>Esc</kbd> to close without linking</li>
          </ul>
          <p>If no object matches, scroll to the "Create" section at the bottom of the popup. Pick a type — Person, Place, Idea, Organization, or <strong>Media</strong> — and click "Create and Link".</p>
          <Callout icon="✅">
            After linking, the @ token becomes the object's name shown as a teal link. Clicking it navigates to the object's page.
          </Callout>
        </Section>

        <Section id="backlinks" title="Backlinks">
          <p>Every time you mention an object with @, that object automatically records a backlink. Open any object page and scroll to the bottom — every diary entry and object note that mentions it appears there.</p>
          <p>Each backlink shows:</p>
          <ul className={styles.list}>
            <li><strong>Date</strong> — formatted as "8 June 2026" for diary entries, or the object name for object-to-object links</li>
            <li><strong>Context snippet</strong> — the five words before and after the mention so you know what the reference was about</li>
          </ul>
          <p>Clicking a diary backlink jumps to that day in the Diary view. Clicking an object backlink opens that object's page.</p>
          <Callout icon="🕸️">
            Backlinks turn your notes into a personal knowledge graph. The more you link, the more connections you discover when you revisit an object weeks later.
          </Callout>
        </Section>

        <Section id="search" title="Search">
          <p>The search bar is pinned to the top of the Diary page. Start typing and results appear instantly — no need to press Enter.</p>
          <p>Search covers:</p>
          <ul className={styles.list}>
            <li>All diary entry content (full text)</li>
            <li>Object titles, descriptions, and notes</li>
          </ul>
          <p>Results show the type (diary entry or object type), a title, and a preview snippet. Clicking a diary result jumps to that date. Clicking an object result opens the object page.</p>
          <Callout icon="🔍">Press <kbd>Esc</kbd> to clear the search and return to the diary view.</Callout>
        </Section>

        <Section id="export" title="Export and Backup">
          <p>Go to the <strong>Export</strong> tab in the left sidebar. Your data is always stored as open formats — Markdown and JSON files on the server.</p>
          <StepList steps={[
            { n:1, title:'Auto-backup', desc:'Headspace automatically exports all data every 3 days. No action needed.' },
            { n:2, title:'Manual export', desc:'Click "Export Now" to trigger an immediate backup to the backup folder on the server.' },
            { n:3, title:'Download zip', desc:'Click "Download Zip" to get a zip file of the entire backup — useful before migrating servers.' },
            { n:4, title:'Import Headspace backup', desc:'Upload a previously downloaded backup zip or JSON file to restore data. Existing entries are updated, new ones are added.' },
            { n:5, title:'Import from Capacities', desc:'Moving from Capacities? In Capacities go to Settings → Export → Markdown export and download the zip. Upload that zip on the Headspace Export page. Daily notes (YYYY-MM-DD.md files) become diary entries; other files are mapped to objects by folder name — People, Places, Books, Organizations, etc.' },
          ]} />
          <Callout icon="💾">
            Point Syncthing at the <code>data/</code> folder to keep a live copy on your phone, laptop, or any other device without any manual steps.
          </Callout>
        </Section>

        <Section id="timer" title="Timer">
          <p>The <strong>Timer</strong> page (clock icon in the sidebar) is a built-in time tracking tool. Log how long you spend on projects and see your work patterns over the week.</p>
          <StepList steps={[
            { n:1, title:'Create a project', desc:'Go to Timer → Projects tab → click "New Project". Give it a name, pick a colour, and optionally add a client name.' },
            { n:2, title:'Start tracking', desc:'On the Dashboard tab, select a project from the dropdown. Type what you are working on in the description field — you can use @ to link objects and # for tags. Click Start.' },
            { n:3, title:'Stop the timer', desc:'Click Stop when you are done. The session is saved automatically. If you start a new project while one is running, the previous one is stopped first.' },
            { n:4, title:'View the week', desc:'The weekly calendar shows all sessions grouped by project per day. Click any day block to see the full breakdown of sessions with start/end times.' },
            { n:5, title:'Reports', desc:'Switch to the Reports tab to see total hours, average per active day, and a stacked bar chart showing how your time is distributed across projects. Export as CSV with one click.' },
          ]} />
          <Callout icon="📅">
            Time logged on a particular day also appears inline in the Diary view for that day — interleaved with your diary entries by timestamp. This gives you a complete picture of the day without switching tabs.
          </Callout>
        </Section>

        <Section id="extension" title="Chrome Extension">
          <p>The Headspace Chrome Extension lets you start and stop timers from any browser tab without opening the full app. It connects directly to your self-hosted Headspace server on the local network.</p>
          <StepList steps={[
            { n:1, title:'Get the extension files', desc:'The chrome-extension/ folder is included in every Headspace release zip. Download the latest zip from GitHub.' },
            { n:2, title:'Load in Chrome', desc:'Open Chrome and go to chrome://extensions. Enable Developer mode (toggle, top right). Click Load unpacked and select the chrome-extension/ folder.' },
            { n:3, title:'Pin it', desc:'Click the puzzle-piece icon in Chrome toolbar, find Headspace Time Tracker and click the pin icon. The pink H logo will appear in your toolbar.' },
            { n:4, title:'Configure server URL', desc:'Click the extension icon. Scroll to the bottom. Confirm the server URL matches your NAS address — default is http://192.168.10.103:5151. Click Save.' },
            { n:5, title:'Start tracking', desc:'Pick a project from the dropdown, type what you are working on, and click Start. The live timer ticks in the popup. Click Stop when done. Today's sessions appear in the list below.' },
          ]} />
          <Callout icon="🌐">
            The extension works on any Windows or Mac machine on the same local network as the Ubuntu NAS. No internet connection is needed — everything stays local.
          </Callout>
        </Section>

        <Section id="tips" title="Tips and Workflow">
          <TipGrid tips={[
            { icon:'🌅', title:'Daily review', desc:'Open Headspace each morning. Skim yesterday\'s entries. Write today\'s first note. It takes 2 minutes and builds a habit.' },
            { icon:'🔗', title:'Link generously', desc:'When you mention a person, place, or idea — link it with @. You\'ll thank yourself when you open that object months later and see the full history.' },
            { icon:'🏷️', title:'Tag consistently', desc:'Use #tags for loose categories: #idea, #todo, #meeting, #learning. Then use the All Entries page filtered by tag for quick reviews.' },
            { icon:'📝', title:'Multiple entries per day', desc:'Don\'t edit the same entry all day. Add a new one each time you sit down. The timestamps tell the story.' },
            { icon:'🎬', title:'Use Media objects', desc:'Create a Media object for every book, film, or podcast you engage with. Link to it from diary entries as you progress. The object page becomes your reading/watching log.' },
            { icon:'🔀', title:'Merge duplicates early', desc:'If you spot two objects for the same person or place, merge them immediately. Use the Merge button on the object page to combine them cleanly.' },
            { icon:'📱', title:'Mobile-friendly', desc:'Headspace works in the mobile browser. The bottom navigation replaces the sidebar on small screens.' },
            { icon:'🔒', title:'Your data, your rules', desc:'Everything lives on your server. No one else has access. Back up the data/ folder regularly and you\'re fully protected.' },
          ]} />
        </Section>

      </div>

        <Section id="credits" title="Credits">
          <p>Headspace is a self-hosted personal knowledge management and diary application — built for privacy, longevity, and local ownership.</p>
          <p style={{ marginTop: 12 }}>
            Developed by{' '}
            <a href="https://github.com/sunnyrabiussunny/headspace"
              target="_blank" rel="noopener noreferrer"
              style={{ color:'var(--accent-teal)', fontWeight:600, textDecoration:'underline', textUnderlineOffset:2 }}>
              Sunny Rabius Sunny
            </a>
            {' '}— the source code, issues, and release zips are all on GitHub.
          </p>
          <Callout icon="⭐">
            If Headspace is useful to you, consider starring the repository on GitHub. It helps others find it and motivates continued development.
          </Callout>
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ id, title, children }) {
  return (
    <section id={`section-${id}`} className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Callout({ icon, children }) {
  return (
    <div className={styles.callout}>
      <span className={styles.calloutIcon}>{icon}</span>
      <div className={styles.calloutText}>{children}</div>
    </div>
  )
}

function CodeBlock({ children }) {
  return <pre className={styles.codeBlock}>{children}</pre>
}

function StepList({ steps }) {
  return (
    <div className={styles.stepList}>
      {steps.map(s => (
        <div key={s.n} className={styles.step}>
          <span className={styles.stepNum}>{s.n}</span>
          <div>
            <div className={styles.stepTitle}>{s.title}</div>
            <div className={styles.stepDesc}>{s.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FeatureGrid({ features }) {
  return (
    <div className={styles.featureGrid}>
      {features.map(f => (
        <div key={f.title} className={styles.featureCard}>
          <span className={styles.featureIcon}>{f.icon}</span>
          <div className={styles.featureTitle}>{f.title}</div>
          <div className={styles.featureDesc}>{f.desc}</div>
        </div>
      ))}
    </div>
  )
}

function TypeGrid({ types }) {
  return (
    <div className={styles.typeGrid}>
      {types.map(t => (
        <div key={t.name} className={styles.typeCard}>
          <span className={styles.typeEmoji}>{t.emoji}</span>
          <div className={styles.typeName}>{t.name}</div>
          <div className={styles.typeDesc}>{t.desc}</div>
        </div>
      ))}
    </div>
  )
}

function TipGrid({ tips }) {
  return (
    <div className={styles.tipGrid}>
      {tips.map(t => (
        <div key={t.title} className={styles.tipCard}>
          <span className={styles.tipIcon}>{t.icon}</span>
          <div className={styles.tipTitle}>{t.title}</div>
          <div className={styles.tipDesc}>{t.desc}</div>
        </div>
      ))}
    </div>
  )
}
