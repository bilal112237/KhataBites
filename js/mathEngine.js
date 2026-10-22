// ============================================================================
// 3. BILL SPLITTING & DEBT SIMPLIFICATION MATH ENGINE
// ============================================================================
// Formula:
//   Shared Pool = Total Bill - Sum(Solo Extras)
//   Equal Base per Eater = Shared Pool / Number of Eaters
//   Person's Final Share = (Equal Base if they ate) + Their Personal Solo Extras

window.computeMealMath = function (meal) {
  const totalBill = Number(meal.totalBill) || 0;
  const eaterIds = Array.isArray(meal.eaterIds) ? meal.eaterIds : [];
  const soloItems = Array.isArray(meal.soloItems) ? meal.soloItems : [];

  const soloTotal = soloItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
  const sharedPool = Math.max(0, totalBill - soloTotal);
  const eatersCount = eaterIds.length;
  const basePerEater = eatersCount > 0 ? sharedPool / eatersCount : 0;

  const sharesByFriend = {};
  eaterIds.forEach(fid => {
    sharesByFriend[fid] = {
      isEater: true,
      sharedBase: basePerEater,
      soloAmount: 0,
      soloDescriptions: [],
      totalShare: basePerEater
    };
  });

  soloItems.forEach(item => {
    const amt = Number(item.amount) || 0;
    if (amt <= 0) return;
    if (!sharesByFriend[item.friendId]) {
      sharesByFriend[item.friendId] = {
        isEater: false,
        sharedBase: 0,
        soloAmount: 0,
        soloDescriptions: [],
        totalShare: 0
      };
    }
    sharesByFriend[item.friendId].soloAmount += amt;
    if (item.item) sharesByFriend[item.friendId].soloDescriptions.push(item.item);
    sharesByFriend[item.friendId].totalShare += amt;
  });

  return {
    totalBill,
    soloTotal,
    sharedPool,
    eatersCount,
    basePerEater,
    sharesByFriend
  };
};

window.computeSquadLedger = function (state) {
  const ledger = {};
  state.friends.forEach(f => {
    ledger[f.id] = {
      friend: f,
      billsPaid: 0,
      totalConsumed: 0,
      soloConsumed: 0,
      settlementsSent: 0,
      settlementsReceived: 0,
      netBalance: 0
    };
  });

  let totalDiningSpent = 0;
  let totalSoloSpent = 0;

  state.meals.forEach(meal => {
    const math = window.computeMealMath(meal);
    totalDiningSpent += math.totalBill;
    totalSoloSpent += math.soloTotal;

    if (ledger[meal.payerId]) {
      ledger[meal.payerId].billsPaid += math.totalBill;
      ledger[meal.payerId].netBalance += math.totalBill;
    }

    Object.keys(math.sharesByFriend).forEach(fid => {
      const share = math.sharesByFriend[fid];
      if (ledger[fid]) {
        ledger[fid].totalConsumed += share.totalShare;
        ledger[fid].soloConsumed += share.soloAmount;
        ledger[fid].netBalance -= share.totalShare;
      }
    });
  });

  let totalSettledAmount = 0;
  let screenshotCount = 0;
  let verbalCount = 0;

  state.settlements.forEach(s => {
    const amt = Number(s.amount) || 0;
    totalSettledAmount += amt;
    if (s.mode === 'screenshot') screenshotCount++;
    else verbalCount++;

    if (ledger[s.fromId]) {
      ledger[s.fromId].settlementsSent += amt;
      ledger[s.fromId].netBalance += amt;
    }
    if (ledger[s.toId]) {
      ledger[s.toId].settlementsReceived += amt;
      ledger[s.toId].netBalance -= amt;
    }
  });

  const debtors = [];
  const creditors = [];
  Object.values(ledger).forEach(entry => {
    const roundedNet = Math.round(entry.netBalance);
    if (roundedNet < -1) {
      debtors.push({ id: entry.friend.id, amount: Math.abs(roundedNet) });
    } else if (roundedNet > 1) {
      creditors.push({ id: entry.friend.id, amount: roundedNet });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const simplifiedTransfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const transferAmt = Math.min(d.amount, c.amount);
    if (transferAmt > 0) {
      simplifiedTransfers.push({
        fromId: d.id,
        toId: c.id,
        amount: Math.round(transferAmt)
      });
    }
    d.amount -= transferAmt;
    c.amount -= transferAmt;
    if (d.amount <= 1) i++;
    if (c.amount <= 1) j++;
  }

  const unsettledPool = simplifiedTransfers.reduce((sum, t) => sum + t.amount, 0);

  return {
    ledger,
    simplifiedTransfers,
    totalDiningSpent,
    totalSoloSpent,
    unsettledPool,
    totalSettledAmount,
    screenshotCount,
    verbalCount
  };
};

window.computeCrossGroupStandingForUser = function (state, userId) {
  let totalNet = 0;
  (state.groups || []).forEach(grp => {
    (grp.meals || []).forEach(meal => {
      const math = window.computeMealMath(meal);
      if (meal.payerId === userId) totalNet += math.totalBill;
      if (math.sharesByFriend[userId]) totalNet -= math.sharesByFriend[userId].totalShare;
    });
    (grp.settlements || []).forEach(s => {
      const amt = Number(s.amount) || 0;
      if (s.fromId === userId) totalNet += amt;
      if (s.toId === userId) totalNet -= amt;
    });
  });
  return Math.round(totalNet);
};
