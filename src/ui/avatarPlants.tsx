import type { GlyphSource } from './avatarTypes';

/** Botanical silhouettes, with enough open space to read at small avatar sizes. */
export const PLANTS: readonly GlyphSource[] = [
  {
    id: 'leaf',
    draw: () => (
      <>
        <path d="M5 18C.5 10 8 3 21 3c1 12-5 19-13 16Z" fill="currentColor" stroke="none" />
        <path d="m4 21 12-12" />
        <path d="m8 17 9-10m-5 6-.4-5m.4 5 5 .3" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M6 10c-1 2-.6 4 .2 5.5" fill="none" stroke="var(--avatar-cutout)" opacity=".22" />
      </>
    ),
  },
  {
    id: 'flower',
    draw: () => (
      <>
        <path d="M12 14v7m0-1c3 0 5-2 6-4-3-.5-5 1-6 4" fill="currentColor" />
        <path
          d="M12 5C8 0 3 4 6 8c-6 0-5 7 .5 7C6 20 12 21 14 16c5 3 9-2 5-5 4-4 0-8-4-6-1-4-4-4-3 0Z"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="12" cy="10.5" r="3.2" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'sunflower',
    draw: () => (
      <>
        <path d="M12 17v4m0-1c-4 0-6-2-6-4 3 0 5 1 6 4" fill="currentColor" />
        <path
          d="m12 2 2.4 3 3.6-.9.5 3.7 3 2.2-2.3 2.9.3 3.7-3.7.4L13 19l-2.5-2.7-3.8.4-.3-3.7L3 11.2l2.1-3.1L5.6 4l3.7.8Z"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="12" cy="10.6" r="4.2" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="12" cy="10.6" r="2.3" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'tulip',
    draw: () => (
      <>
        <path d="M12 13v8" />
        <path
          d="M12 21C6 22 3 17 3 12c5 1 7 4 9 9Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path d="M12 21c1-5 4-8 9-10-1 7-4 10-9 10Z" fill="currentColor" stroke="none" />
        <path
          d="M6 3c2 .2 4 1.6 6 4 2-2.4 4-3.8 6-4v5c0 4-2.5 6.5-6 6.5S6 12 6 8Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m8.7 5.5 3.3-3 3.3 3L12 9Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M12 8v3.5" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'rose',
    draw: () => (
      <>
        <path d="M12 14v7m0-2c-4 0-6-2-6-4 3 0 5 1 6 4" fill="currentColor" />
        <path d="M12 18c3-4 5-4 7-4-1 3-3 4-7 4Z" fill="currentColor" stroke="none" opacity=".22" />
        <path
          d="M9 3c2-1 5-1 6 1 4-1 7 3 5 6 .4 4-4 7-8 5-4 2-8-1-8-5C2 6 5 2 9 3Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M8 6c5-2 9 3 5 5-3 1-5-2-3-3m-4 3c1 2 4 3 7 3m5-7c0 3-1 5-3 6"
          fill="none"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.5"
        />
      </>
    ),
  },
  {
    id: 'cactus',
    draw: () => (
      <>
        <path
          d="M9 18V6a3 3 0 0 1 6 0v7h2V9a2 2 0 0 1 4 0v5a3 3 0 0 1-3 3h-3v2H9v-6H6a3 3 0 0 1-3-3V8a2 2 0 0 1 4 0v2h2Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M12 6v10M5 8v2" stroke="var(--avatar-cutout)" strokeWidth="1.4" />
        <path d="M7 18h10l-1 4H8Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M7 18h10" />
        <path d="M14 4c0-2 2-2 3-1 0 2-1 3-3 1Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'sprout',
    draw: () => (
      <>
        <path d="M12 21v-5c0-3 1-5 4-8M7 21h10" />
        <path
          d="M12 15C5 16 2 11 3 6c6 0 10 3 9 9Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path d="M12 12C11 5 16 2 22 3c0 7-4 11-10 9Z" fill="currentColor" stroke="none" />
        <path d="m14 10 4-4" stroke="var(--avatar-cutout)" />
        <path d="m6 10 5 4" />
      </>
    ),
  },
  {
    id: 'tree',
    draw: () => (
      <>
        <path d="M9 21h7l-2-7h-3Z" fill="currentColor" stroke="none" />
        <path
          d="M7 17C2 17 1 11 4 9 2 4 8 1 12 4c4-4 10 0 8 5 4 4 0 10-5 8-2 2-6 2-8 0Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M12 17V9m0 5L8 10m4 2 4-4" stroke="var(--avatar-cutout)" fill="none" />
        <path d="M6 21h12" />
      </>
    ),
  },
  {
    id: 'palm',
    draw: () => (
      <>
        <path d="M11 9c3 4 5 8 5 12h-5c2-4 1-8 0-12Z" fill="currentColor" stroke="none" />
        <path
          d="M12 9C7 7 4 9 2 13c-1-6 4-10 10-7-1-4 3-5 7-3-3 0-5 2-5 4 5-3 8 1 8 6-3-3-6-4-10-4Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M11 7C6 8 3 6 3 3c5-1 8 1 8 4Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="m12 14 2.2-.5m-1 4 1.8-.4" stroke="var(--avatar-cutout)" />
        <path d="M6 21h13" />
      </>
    ),
  },
  {
    id: 'mushroom',
    draw: () => (
      <>
        <path d="m9 12-1 7c-.3 3 8.3 3 8 0l-1-7Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M9 14 8 19c-.3 2.7 8.3 2.7 8 0l-1-5" fill="none" />
        <path d="M2 13C2 6 7 3 12 3s10 3 10 10c-5 2-15 2-20 0Z" fill="currentColor" stroke="none" />
        <circle cx="8" cy="8" r="2" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="16" cy="9" r="2.4" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M11 17v2" />
      </>
    ),
  },
  {
    id: 'clover',
    draw: () => (
      <>
        <path d="M12 13c0 4 2 6 5 8" />
        <path
          d="M11 11C3 9 3 5 6 4c2-1 3 0 3 2 1-3 4-4 6-2 2 3-1 6-4 7Zm2 0c2-8 6-8 7-5 1 2 0 3-2 3 3 1 4 4 2 6-3 2-6-1-7-4Zm-2 2c-2 8-6 8-7 5-1-2 0-3 2-3-3-1-4-4-2-6 3-2 6 1 7 4Zm2 0c8 2 8 6 5 7-2 1-3 0-3-2-1 3-4 4-6 2-2-3 1-6 4-7Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m10 10 4 4m0-4-4 4" stroke="var(--avatar-cutout)" strokeWidth="1.4" />
      </>
    ),
  },
  {
    id: 'fern',
    draw: () => (
      <>
        <path d="M7 21C7 13 11 7 17 3" />
        <path
          d="M8 18c-5-1-6-5-4-8 3 1 5 4 4 8Zm3-6C7 11 6 7 8 5c3 1 4 4 3 7Zm4-6c-1-3 1-4 4-4 0 3-2 5-4 4Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M8 18c3-5 7-5 11-2-2 4-6 5-11 2Zm3-6c3-4 6-4 10-2-2 4-6 5-10 2Zm3-5c3-2 5-2 7 0-2 2-4 3-7 0Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
      </>
    ),
  },
  {
    id: 'bonsai',
    draw: () => (
      <>
        <path
          d="M11 9h3c-3 3-1 4 3 5 2 1 2 3 0 5h-7c4-2 5-3 1-4-3-1-3-3 0-6Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M4 9C2 5 6 3 9 5c1-4 8-4 9 0 4 0 5 4 2 6H7Z" fill="currentColor" stroke="none" />
        <path
          d="M3 14c-1-4 5-6 8-2 4 0 4 4 1 4H4Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path d="M7 8h4m4 0h3" stroke="var(--avatar-cutout)" />
        <path d="M5 18h15l-2 4H7Z" fill="currentColor" stroke="none" />
        <path d="M6 18h13" stroke="var(--avatar-cutout)" strokeWidth="1.4" />
      </>
    ),
  },
  {
    id: 'monstera',
    draw: () => (
      <>
        <path
          d="M11 21C2 18 1 10 4 6c3-4 7-3 8 0 3-4 8-3 9 1 3 7-3 13-10 14Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M12 20V8M4 9l4 3m-4 3 4 2m12-8-4 3m4 3-4 2"
          stroke="var(--avatar-cutout)"
          fill="none"
          strokeWidth="1.8"
        />
      </>
    ),
  },
  {
    id: 'lotus',
    draw: () => (
      <>
        <path
          d="M3 18c4-2 14-2 18 0-2 5-16 5-18 0Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path
          d="M12 18C5 18 2 13 3 7c5 1 8 4 9 11Zm0 0c7 0 10-5 9-11-5 1-8 4-9 11Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M12 3c-6 5-6 10 0 15 6-5 6-10 0-15Z"
          fill="currentColor"
          stroke="var(--avatar-cutout)"
        />
        <path d="M12 9v5" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'acorn',
    draw: () => (
      <>
        <path d="M12 6c0-2 1-3 3-3" />
        <path d="M6 10h12v4c0 4-3 6-6 8-3-2-6-4-6-8Z" fill="currentColor" stroke="none" />
        <path d="M4 11c0-4 3-6 8-6s8 2 8 6Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M4 11c0-4 3-6 8-6s8 2 8 6H4Z" fill="none" />
        <path d="M9 14c0 2 1 3 2 4" stroke="var(--avatar-cutout)" fill="none" />
      </>
    ),
  },
];
