// Starter structure + the sample library shown in preview mode.
//
// STARTER_CATEGORIES is offered to every new account (they are ordinary
// categories afterwards: rename, reorder or delete them freely).
// The sample bookmarks only ever exist in preview mode's local storage and
// are never written to the database.

import { normalizeUrl, domainOf } from '../lib/url.js';

export const STARTER_CATEGORIES = [
  {
    name: 'Design',
    icon: 'pen-tool',
    description: 'Interfaces, systems and visual references worth keeping.',
    subs: ['Product Design', 'Graphic Design', 'UX Research', 'UI Inspiration', 'Design Systems', 'Typography'],
  },
  {
    name: 'Development',
    icon: 'code',
    description: 'Docs, libraries and tools for building things.',
    subs: ['Frontend', 'Backend', 'Documentation', 'Libraries', 'AI Tools'],
  },
  {
    name: 'Reading',
    icon: 'book-open',
    description: 'Articles and long reads to come back to.',
    subs: ['Articles', 'Case Studies', 'Research', 'Essays'],
  },
  { name: 'Inspiration', icon: 'lightbulb', description: 'Things that spark ideas.', subs: [] },
  { name: 'Productivity', icon: 'zap', description: 'Tools and methods for getting work done.', subs: [] },
  { name: 'Personal', icon: 'user', description: 'Everything that is just for you.', subs: [] },
];

// [url, title, description, category, subcategory, tags, thumb width, thumb height, flags]
const SAMPLES = [
  ['https://linear.app/method', 'Linear Method — Practices for building', 'Principles and practices that guide how the Linear team builds products.', 'Design', 'Product Design', ['process', 'product'], 800, 1000, 'fav'],
  ['https://vercel.com/design', 'Vercel Design', 'Geist: the design system behind Vercel — colors, type, components and brand guidelines.', 'Design', 'Design Systems', ['design-system', 'tokens'], 800, 520],
  ['https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Masonry_layout', 'Masonry layout — CSS | MDN', 'Level 3 of the CSS grid layout specification includes a masonry value for grid-template-columns and grid-template-rows.', 'Development', 'Frontend', ['css', 'layout'], 800, 620],
  ['https://www.nngroup.com/articles/ten-usability-heuristics/', '10 Usability Heuristics for User Interface Design', "Jakob Nielsen's general principles for interaction design.", 'Design', 'UX Research', ['heuristics', 'ux'], 800, 880, 'fav'],
  ['https://rauno.me/craft/interaction-design', 'Invisible Details of Interaction Design', 'Deconstructing why some interactions feel right, using first principles.', null, null, ['interaction'], 800, 560],
  ['https://fonts.google.com/specimen/Geist', 'Geist — Google Fonts', 'A typeface made for developers and designers, embodying Swiss design principles.', 'Design', 'Typography', ['fonts'], 800, 480],
  ['https://supabase.com/docs/guides/database/postgres/row-level-security', 'Row Level Security | Supabase Docs', 'Secure your data using Postgres Row Level Security.', 'Development', 'Documentation', ['postgres', 'security'], 800, 460],
  ['https://www.joshwcomeau.com/css/interactive-guide-to-grid/', 'An Interactive Guide to CSS Grid', 'A mental model for one of the most powerful layout tools on the web.', 'Development', 'Frontend', ['css', 'layout'], 800, 720],
  ['https://paulgraham.com/greatwork.html', 'How to Do Great Work', '', 'Reading', 'Essays', ['essay'], 0, 0],
  ['https://www.are.na/explore', 'Are.na / Explore', 'A platform for connecting ideas and building knowledge.', 'Inspiration', null, ['moodboard'], 800, 980],
  ['https://mobbin.com/browse/web/apps', 'Mobbin — Web app design references', 'Thousands of screens and flows from the best products.', 'Design', 'UI Inspiration', ['references', 'ui'], 800, 640, 'fav'],
  ['https://stripe.com/blog/accessible-color-systems', 'Designing accessible color systems', 'How Stripe built a color system with hand-picked, perceptually uniform colors.', 'Reading', 'Case Studies', ['color', 'accessibility'], 800, 540],
  ['https://github.com/pmndrs/zustand', 'pmndrs/zustand: Bear necessities for state management', 'A small, fast and scalable state-management solution.', 'Development', 'Libraries', ['react', 'state'], 800, 400],
  ['https://basecamp.com/shapeup', 'Shape Up: Stop Running in Circles and Ship Work that Matters', 'A guide to how Basecamp does product development.', 'Productivity', null, ['process'], 800, 1040],
  ['https://www.figma.com/blog/the-future-of-design-systems-is-semantic/', 'The future of design systems is semantic', 'Variables, modes and what semantic tokens unlock for teams.', null, null, ['design-system'], 800, 500],
  ['https://docs.anthropic.com/en/docs/build-with-claude/tool-use', 'Tool use with Claude', 'Connect Claude to external tools and APIs.', 'Development', 'AI Tools', ['ai', 'api'], 800, 450],
  ['https://www.typewolf.com/site-of-the-day', 'Typewolf — Site of the Day', 'What is trending in type, updated daily.', 'Design', 'Typography', ['fonts', 'references'], 800, 900],
  ['https://refactoringui.com/', 'Refactoring UI', 'Make your ideas look awesome, without relying on a designer.', 'Design', 'Product Design', ['ui'], 800, 600],
  ['https://example.invalid/retired-case-study', 'Retired case study', '', null, null, [], 0, 0, 'failed'],
  ['https://web.dev/articles/vitals', 'Web Vitals', 'Essential metrics for a healthy site.', 'Development', 'Frontend', ['performance'], 800, 430],
  ['https://www.pentagram.com/work', 'Pentagram — Work', "The world's largest independent design consultancy.", 'Design', 'Graphic Design', ['branding'], 800, 1100],
  ['https://maggieappleton.com/garden-history', 'A Brief History & Ethos of the Digital Garden', 'A newly revived philosophy for publishing personal knowledge on the web.', 'Reading', 'Articles', ['notes', 'knowledge'], 800, 680, 'fav'],
  ['https://tailwindcss.com/docs/theme', 'Theme variables — Tailwind CSS', 'Using utility classes and theme variables as design tokens.', null, null, ['css', 'tokens'], 800, 470],
  ['https://www.gov.uk/guidance/government-design-principles', 'Government Design Principles', 'Start with user needs. Do less. Design with data.', 'Design', 'UX Research', ['principles'], 800, 560],
  ['https://todoist.com/productivity-methods/time-blocking', 'Time Blocking — Your Complete Guide', 'Plan every moment of your day in advance.', 'Productivity', null, ['focus'], 800, 760],
  ['https://www.nytimes.com/wirecutter/', 'Wirecutter: New Product Reviews, Deals, and Buying Advice', 'Independent reviews of everything.', 'Personal', null, ['shopping'], 800, 520],
  ['https://read.cv/explore', 'Read.cv — Explore', 'Profiles and work from designers and engineers.', 'Inspiration', null, ['people'], 800, 840],
  ['https://jakearchibald.com/2025/animating-zooming/', 'Animating zooming using CSS', 'Transform order matters… sometimes.', 'Development', 'Frontend', ['css', 'animation'], 800, 500],
];

const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function buildSampleLibrary() {
  const stamp = new Date().toISOString();
  const categories = [];
  const subcategories = [];

  STARTER_CATEGORIES.forEach((starter, position) => {
    const category = { id: id(), name: starter.name, icon: starter.icon, description: starter.description, position, created_at: stamp };
    categories.push(category);
    starter.subs.forEach((name, subPosition) => {
      subcategories.push({ id: id(), category_id: category.id, name, position: subPosition, created_at: stamp });
    });
  });

  const tags = [];
  const linkTags = [];
  const tagId = (name) => {
    let tag = tags.find((t) => t.name === name);
    if (!tag) tags.push((tag = { id: id(), name }));
    return tag.id;
  };

  const links = SAMPLES.map(([url, title, description, categoryName, subName, tagNames, w, h, flag], index) => {
    const category = categories.find((c) => c.name === categoryName);
    const sub = category && subcategories.find((s) => s.category_id === category.id && s.name === subName);
    // Newest first, spread over the last few weeks so sorting has something to show.
    const created = new Date(Date.now() - (index * 9 + 1) * 3600000 * (1 + index / 6)).toISOString();
    const link = {
      id: id(),
      url,
      normalized_url: normalizeUrl(url),
      domain: domainOf(url),
      title,
      description: description || null,
      favicon_url: null,
      thumbnail_url: w ? `https://picsum.photos/seed/h3aven-${index}/${w}/${h}` : null,
      category_id: category ? category.id : null,
      subcategory_id: sub ? sub.id : null,
      notes: null,
      selected_text: null,
      is_favorite: flag === 'fav',
      source: 'sample',
      content_type: 'link',
      fetch_status: flag === 'failed' ? 'failed' : 'ready',
      metadata: {},
      created_at: created,
      updated_at: created,
      last_accessed_at: null,
    };
    tagNames.forEach((name) => linkTags.push({ link_id: link.id, tag_id: tagId(name) }));
    return link;
  });

  return { links, categories, subcategories, tags, linkTags, seeded: true };
}
