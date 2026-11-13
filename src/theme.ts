export const theme = {
  colors: {
    // Backgrounds
    background: '#F4F7F5',
    backgroundGradStart: '#EDF5F0',
    backgroundGradEnd: '#F7FAF8',
    surface: '#FFFFFF',
    surfaceSecondary: '#F8FAF9',
    surfaceElevated: '#FFFFFF',

    // Hero Lime Accent (matching Reference Image 3)
    heroLime: '#EEF876',
    heroLimeDark: '#D8E84D',
    heroText: '#182006',
    heroSubtext: '#4F5E24',

    // Dark Card Accent (matching Reference Image 1)
    darkCard: '#111216',
    darkCardElevated: '#1A1C23',
    darkCardText: '#FFFFFF',
    darkCardSubtext: '#9CA3AF',
    darkCardBorder: '#272A34',

    // Text colors
    textPrimary: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#9CA3AF',
    textSubtle: '#6B7280',
    textInverse: '#FFFFFF',

    // Financial Status Colors
    creditGreen: '#10B981',
    creditGreenLight: '#ECFDF5',
    creditGreenDark: '#047857',
    debitRed: '#E11D48',
    debitRedLight: '#FFF1F2',
    debitRedDark: '#BE123C',
    warningOrange: '#F59E0B',
    warningOrangeLight: '#FEF3C7',
    infoBlue: '#3B82F6',
    infoBlueLight: '#EFF6FF',
    purpleAccent: '#8B5CF6',
    purpleAccentLight: '#F5F3FF',

    // Borders & Dividers
    border: '#E8ECE9',
    borderLight: '#F1F4F2',
    borderFocus: '#111827',

    // Tab & Dock
    dockBackground: '#FFFFFF',
    dockBorder: '#E5E9E6',
    dockActiveBg: '#111216',
    dockActiveIcon: '#FFFFFF',
    dockInactiveIcon: '#8E9893',
  },

  radius: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 22,
    xl: 28,
    full: 9999,
  },

  shadows: {
    subtle: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 2,
    },
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 14,
      elevation: 3,
    },
    hero: {
      shadowColor: '#A3B838',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 5,
    },
    dock: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 10,
    },
  },
};

// Map categories to appropriate Ionicons & soft badge background colors
export function getCategoryMeta(categoryName: string, type: 'CREDIT' | 'DEBIT' = 'DEBIT') {
  const norm = (categoryName || '').toLowerCase().trim();

  if (norm.includes('milk') || norm.includes('dairy')) {
    return { icon: 'cafe' as const, bg: '#FEF3C7', color: '#B45309' };
  }
  if (norm.includes('auto') || norm.includes('cab') || norm.includes('taxi') || norm.includes('rickshaw')) {
    return { icon: 'car' as const, bg: '#E0F2FE', color: '#0284C7' };
  }
  if (norm.includes('gold') || norm.includes('jewel')) {
    return { icon: 'sparkles' as const, bg: '#FEF08A', color: '#B45309' };
  }
  if (norm.includes('food') || norm.includes('grocer') || norm.includes('dine') || norm.includes('restaurant') || norm.includes('swiggy') || norm.includes('zomato')) {
    return { icon: 'fast-food' as const, bg: '#FEF3C7', color: '#D97706' };
  }
  if (norm.includes('shop') || norm.includes('cloth') || norm.includes('amazon') || norm.includes('flipkart') || norm.includes('myntra') || norm.includes('store') || norm.includes('nike')) {
    return { icon: 'bag-handle' as const, bg: '#FCE7F3', color: '#DB2777' };
  }
  if (norm.includes('movie') || norm.includes('entertain') || norm.includes('netflix') || norm.includes('prime') || norm.includes('spotify') || norm.includes('multiplex') || norm.includes('megogo') || norm.includes('game')) {
    return { icon: 'film' as const, bg: '#EDE9FE', color: '#7C3AED' };
  }
  if (norm.includes('travel') || norm.includes('flight') || norm.includes('train') || norm.includes('uber') || norm.includes('ola')) {
    return { icon: 'airplane' as const, bg: '#E0F2FE', color: '#0284C7' };
  }
  if (norm.includes('fuel') || norm.includes('petrol') || norm.includes('diesel') || norm.includes('cng')) {
    return { icon: 'speedometer' as const, bg: '#FEE2E2', color: '#DC2626' };
  }
  if (norm.includes('bill') || norm.includes('electric') || norm.includes('wifi') || norm.includes('recharge') || norm.includes('water') || norm.includes('gas') || norm.includes('utility')) {
    return { icon: 'flash' as const, bg: '#FEF9C3', color: '#CA8A04' };
  }
  if (norm.includes('salary') || norm.includes('income') || norm.includes('freelance') || norm.includes('dividend') || norm.includes('profit') || norm.includes('bonus')) {
    return { icon: 'cash' as const, bg: '#D1FAE5', color: '#059669' };
  }
  if (norm.includes('invest') || norm.includes('stock') || norm.includes('crypto') || norm.includes('binance') || norm.includes('mutual')) {
    return { icon: 'trending-up' as const, bg: '#DCFCE7', color: '#16A34A' };
  }
  if (norm.includes('health') || norm.includes('med') || norm.includes('doctor') || norm.includes('pharm') || norm.includes('hospital')) {
    return { icon: 'fitness' as const, bg: '#FEE2E2', color: '#DC2626' };
  }
  if (norm.includes('gym') || norm.includes('fit') || norm.includes('sport')) {
    return { icon: 'barbell' as const, bg: '#CCFBF1', color: '#0F766E' };
  }
  if (norm.includes('education') || norm.includes('book') || norm.includes('course') || norm.includes('fee')) {
    return { icon: 'school' as const, bg: '#DBEAFE', color: '#1D4ED8' };
  }
  if (norm.includes('home') || norm.includes('rent') || norm.includes('house') || norm.includes('maintenance')) {
    return { icon: 'home' as const, bg: '#E0E7FF', color: '#4F46E5' };
  }
  if (norm.includes('transf') || norm.includes('upi') || norm.includes('p2p') || norm.includes('person') || norm.includes('received') || norm.includes('sent')) {
    return { icon: 'swap-horizontal' as const, bg: '#F3E8FF', color: '#9333EA' };
  }
  if (type === 'CREDIT') {
    return { icon: 'arrow-down-circle' as const, bg: '#ECFDF5', color: '#10B981' };
  }
  return { icon: 'receipt' as const, bg: '#F3F4F6', color: '#4B5563' };
}

