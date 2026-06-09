import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './GuidePage.module.css'

const SECTIONS = [
  { id: 'what',     label: 'What is Headspace?' },
  { id: 'diary',    label: 'The Diary' },
  { id: 'objects',  label: 'Objects' },
  { id: 'linking',  label: 'Linking with @' },
  { id: 'backlinks',label: 'Backlinks' },
  { id: 'search',   label: 'Search' },
  { id: 'export',   label: 'Export and Backup' },
  { id: 'tips',     label: 'Tips and Workflow' },
]

export default function GuidePage() {
  const navigate  = useNavigate()
  const [active, setActive] = useState('what')

  const scrollTo = (id) => {
    setActive(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={styles.page}>

      {/* Left: section nav (desktop only) */}
      <nav className={styles.toc}>
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
          <p>Everything is stored as plain Markdown and JSON files, so you can read, back up, and sync your notes with any tool you like, including Syncthing.</p>
          <Callout icon="💡">Think of Headspace as your calm private studio — a place to write daily notes, connect ideas, and build a personal knowledge graph over time.</Callout>
          <FeatureGrid features={[
            { icon:'📅', title:'Diary', desc:'Write daily notes anchored to a calendar. Multiple entries per day, all on one page.' },
            { icon:'👤', title:'Objects', desc:'People, places, ideas, and organizations — each with their own page, notes, and backlinks.' },
            { icon:'🔗', title:'Linking', desc:'Type @ anywhere to link diary entries to objects. Links are bidirectional — backlinks appear automatically.' },
            { icon:'🔍', title:'Search', desc:'Full-text search across everything — diary entries and all objects.' },
            { icon:'💾', title:'Export', desc:'Auto-backup every 3 days as Markdown and JSON. Restore or sync with Syncthing anytime.' },
          ]} />
        </Section>

        <Section id="diary" title="The Diary">
          <p>The Diary is the default home screen. It shows a <strong>week strip</strong> at the top — you can click any day to jump to it. The currently selected day shows all entries written on that date.</p>
          <StepList steps={[
            { n:1, title:'Navigate to any date', desc:'Click a day in the week strip, use the left/right arrows to move week by week, or click the calendar icon at the top right of the week strip to jump to any date by picking from a full month view.' },
            { n:2, title:'Add a Daily Note', desc:'Click the dashed "+ Daily Note" button at the bottom of the entries list. A new entry opens in editing mode with a teal border.' },
            { n:3, title:'Write freely', desc:'Type anything. You can write multiple entries per day — each gets its own timestamp and can be edited independently. Click "Done" to close the editor and see the read-only card.' },
            { n:4, title:'Link objects with @', desc:'While writing, type @ to open the object search popup. Results appear below the editor. Navigate with ↑↓, press Enter to select, or click with the mouse.' },
          ]} />
          <Callout icon="📅">
            The green day name (e.g. "Wednesday") or red "Today" badge at the top of the content area always tells you which day you are viewing. The "Today" button in the week strip takes you back to today instantly.
          </Callout>
        </Section>

        <Section id="objects" title="Objects">
          <p>Objects are the building blocks of your knowledge graph. Every person, place, idea, or organization you want to remember gets its own object page.</p>
          <p>There are four built-in object types:</p>
          <TypeGrid types={[
            { emoji:'👤', name:'Person', desc:'Someone you know, have met, or want to remember — friends, colleagues, authors, historical figures.' },
            { emoji:'📍', name:'Place',  desc:'Locations you have been to or want to visit — cities, restaurants, venues, countries.' },
            { emoji:'💡', name:'Idea',   desc:'Concepts, projects, topics, or anything that doesn\'t fit neatly elsewhere.' },
            { emoji:'🏢', name:'Organization', desc:'Companies, institutions, communities, or groups.' },
          ]} />
          <StepList steps={[
            { n:1, title:'Create an object', desc:'Go to the Objects tab. Click "New" in the top right. Choose a type, enter a name, and click Create.' },
            { n:2, title:'Write notes', desc:'On the object\'s page, type in the Notes area. You can also use @ here to link this object to others.' },
            { n:3, title:'See where it\'s mentioned', desc:'Scroll to the Backlinks section at the bottom of the object page. Every diary entry or object note that mentions this object appears there as a clickable link with a context snippet.' },
          ]} />
          <Callout icon="🔗">
            You don\'t have to go to the Objects tab to create a new object. Type @NewName in any diary entry or object notes, and if it doesn\'t exist you\'ll see a "Create" option with a type picker right in the popup.
          </Callout>
        </Section>

        <Section id="linking" title="Linking with @">
          <p>Linking is the most powerful feature in Headspace. Any diary entry or object note can reference any object using the @ symbol.</p>
          <CodeBlock>
{`Today I had lunch with @Riyan Hoq Lappeenranta at @Cafe Aalto.
We talked about the @Headspace project and next steps.`}
          </CodeBlock>
          <p>When you type <code>@</code>, a search popup appears immediately below the text area. You can:</p>
          <ul className={styles.list}>
            <li>Type letters to filter — spaces are allowed, so "Riyan Ho" will find "Riyan Hoq Lappeenranta"</li>
            <li>Use <kbd>↑</kbd> <kbd>↓</kbd> arrow keys to navigate results</li>
            <li>Press <kbd>Enter</kbd> to select the highlighted result</li>
            <li>Click any result with the mouse</li>
            <li>Press <kbd>Esc</kbd> to close the popup without linking</li>
          </ul>
          <p>If no object matches, scroll to the "Create" section at the bottom of the popup. Pick a type (Person, Place, Idea, Organization) and click "Create and Link" — the new object is created and linked in one step.</p>
          <Callout icon="✅">
            After selecting or creating an object, the @ token in your text is replaced by the object's name shown as a teal underlined link. Clicking that link navigates to the object's page.
          </Callout>
        </Section>

        <Section id="backlinks" title="Backlinks">
          <p>Every time you mention an object with @, that object automatically records a backlink. Open any object page and scroll to the bottom — you will see every diary entry and object note that has ever mentioned it.</p>
          <p>Each backlink shows:</p>
          <ul className={styles.list}>
            <li><strong>Date</strong> — formatted as "8 June, 2026" for diary entries, or the object name for object-to-object links</li>
            <li><strong>Context snippet</strong> — the five words before and after the mention, so you immediately know what the reference was about</li>
          </ul>
          <p>Clicking a diary backlink jumps straight to that day in the Diary view. Clicking an object backlink opens that object's page.</p>
          <Callout icon="🕸️">
            Backlinks are how Headspace turns your notes into a personal knowledge graph. The more you link, the more connections you discover when you revisit an object weeks later.
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
          <p>Go to the <strong>Export</strong> tab in the left sidebar. Your data is always stored as open formats:</p>
          <ul className={styles.list}>
            <li><code>data/backups/diary/YYYY-MM-DD.md</code> — human-readable Markdown</li>
            <li><code>data/backups/diary/UUID.json</code> — machine-readable for re-import</li>
            <li><code>data/backups/objects/TYPE_Name.md</code> — object notes as Markdown</li>
            <li><code>data/backups/objects/UUID.json</code> — object data for re-import</li>
          </ul>
          <StepList steps={[
            { n:1, title:'Auto-backup', desc:'Headspace automatically exports all data every 3 days, replacing the previous backup. No action needed.' },
            { n:2, title:'Manual export', desc:'Click "Export Now" to trigger an immediate backup to the backup folder on the server.' },
            { n:3, title:'Download zip', desc:'Click "Download Zip" to get a zip file of the entire backup — useful before migrating servers.' },
            { n:4, title:'Import', desc:'Upload a backup zip or JSON file to restore data. Existing entries are updated, new ones are added.' },
            { n:5, title:'Syncthing', desc:'Point Syncthing at the backup folder to keep a live copy on your phone, laptop, or any other device.' },
          ]} />
        </Section>

        <Section id="tips" title="Tips and Workflow">
          <TipGrid tips={[
            { icon:'🌅', title:'Daily review', desc:'Open Headspace each morning. Skim yesterday\'s entries. Write today\'s first note. It takes 2 minutes and builds a habit.' },
            { icon:'🔗', title:'Link generously', desc:'When you mention a person, place, or idea — link it. You\'ll thank yourself when you open that object months later and see the full history.' },
            { icon:'📝', title:'Multiple entries per day', desc:'Don\'t edit the same entry all day. Add a new one each time you sit down. The timestamps tell the story.' },
            { icon:'🏷️', title:'Object types as lenses', desc:'Use Persons for people, Places for locations, Ideas for projects and concepts, Organizations for companies and groups. These four cover almost everything.' },
            { icon:'📱', title:'Mobile-friendly', desc:'Headspace works in the mobile browser too. The bottom navigation replaces the sidebar on small screens.' },
            { icon:'🔒', title:'Your data, your rules', desc:'Everything lives on your server. No one else has access. Back up the data/ folder and you\'re fully protected.' },
          ]} />
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
