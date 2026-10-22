// ============================================================================
// 2. INITIAL DEFAULT DATA (CLEAN PRODUCTION STATE - ZERO DUMMY MEALS)
// ============================================================================

window.DEFAULT_STATE = {
  currency: 'Rs.',
  perspectiveId: 'f1',
  loggedInUserId: 'f1',
  activeTab: 'owes',
  activePage: 'dashboard',
  isAdminUnlocked: false,
  friends: [
    { id: 'f1', name: 'Admin (You)', room: 'Hostel Room 1', walletApp: 'SadaPay', walletNum: '0300-0000000', color: '#C2410C' }
  ],
  meals: [],
  settlements: []
};

window.MULTI_GROUPS_PRESETS = [
  {
    id: 'g_hostel_dinner',
    name: 'Main Uni & Hostel Squad',
    schedule: 'Daily Squad Meals',
    code: 'SQUAD-1',
    meals: [],
    settlements: []
  }
];
