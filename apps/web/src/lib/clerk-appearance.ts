// Clerk's <SignIn /> / <SignUp /> components, themed to the 1Scratch
// drafting aesthetic. Passed to the `appearance` prop. Typed loosely
// because @clerk/types was deprecated in Core 3 and no stable shape
// export replaced it yet for Next.js 7.x.

export const clerkAppearance = {
  variables: {
    colorPrimary: '#1a1814',
    colorText: '#1a1814',
    colorTextSecondary: '#4a4439',
    colorBackground: '#fbf8f0',
    colorInputBackground: '#f5f1e8',
    colorInputText: '#1a1814',
    colorDanger: '#c2410c',
    fontFamily: 'var(--font-newsreader), Georgia, serif',
    fontFamilyButtons: 'var(--font-jetbrains), monospace',
    borderRadius: '0',
    spacingUnit: '1rem',
  },
  elements: {
    rootBox: 'w-full',
    card: {
      background: '#fbf8f0',
      border: '1px solid #2d2a23',
      boxShadow: '0 1px 0 rgba(45,42,35,0.06), 0 24px 48px -24px rgba(45,42,35,0.25)',
      padding: '2rem',
    },
    headerTitle: {
      fontFamily: 'var(--font-fraunces)',
      fontWeight: 400,
      fontSize: '2rem',
      letterSpacing: '-0.01em',
    },
    headerSubtitle: {
      fontFamily: 'var(--font-newsreader)',
      color: '#4a4439',
    },
    socialButtonsBlockButton: {
      border: '1px solid #2d2a23',
      borderRadius: '0',
      background: '#f5f1e8',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontSize: '11px',
      ':hover': { background: '#ede7d7' },
    },
    formButtonPrimary: {
      background: '#1a1814',
      color: '#f5f1e8',
      borderRadius: '0',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontSize: '12px',
      padding: '0.9rem 1rem',
      ':hover': { background: '#2d2a23' },
    },
    formFieldInput: {
      borderRadius: '0',
      border: '1px solid #2d2a23',
      background: '#f5f1e8',
      ':focus': { boxShadow: '0 0 0 2px #c2410c' },
    },
    formFieldLabel: {
      fontFamily: 'var(--font-jetbrains)',
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      color: '#4a4439',
    },
    footer: { display: 'none' },                    // we render our own
    footerAction: { display: 'none' },
    dividerLine: { background: '#2d2a23' },
    dividerText: {
      fontFamily: 'var(--font-jetbrains)',
      fontSize: '10px',
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: '#4a4439',
    },
  },
} as const
