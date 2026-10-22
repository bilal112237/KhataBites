(function () {
      const externalCfg = window.KhataConfig || {};
      const STORAGE_KEY = externalCfg.STORAGE_KEY || 'khatabites_clean_prod_v2';
      // ============================================================================
      // REAL DATABASE CONFIG (Paste your free Supabase URL & Anon Key here or in
      // js/config.js before uploading to GitHub/Vercel so every phone connects!)
      // ============================================================================
      const HARDCODED_SUPABASE_URL = externalCfg.HARDCODED_SUPABASE_URL || '';
      const HARDCODED_SUPABASE_ANON_KEY = externalCfg.HARDCODED_SUPABASE_ANON_KEY || '';
      const CLOUD_ROOM_KEY = externalCfg.CLOUD_ROOM_KEY || 'uni_hostel_main_squad';
      let supabaseClient = null;

      // Clean Production Default State (Zero Dummy Meals or Fake Debts!)
      const DEFAULT_STATE = {
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

      let state = loadState();
      let draftSoloItems = [];
      let draftUploadedScreenshotDataUrl = null;

      function loadState() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.friends) && Array.isArray(parsed.meals)) {
              return parsed;
            }
          }
        } catch (err) {
          // Ignore storage errors in sandboxed iframes
        }
        return JSON.parse(JSON.stringify(DEFAULT_STATE));
      }

      function saveState() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) {
          // Ignore storage errors
        }
        if (supabaseClient) {
          supabaseClient
            .from('khata_cloud_store')
            .upsert({ room_key: CLOUD_ROOM_KEY, payload: state, updated_at: new Date().toISOString() }, { onConflict: 'room_key' })
            .then(({ error }) => {
              if (!error) updateCloudStatusUI(true);
            })
            .catch(() => {});
        }
      }

      function updateCloudStatusUI(isConnected) {
        const txt = document.getElementById('cloudStatusText');
        const modalBadge = document.getElementById('modalCloudConnBadge');
        if (txt) {
          txt.textContent = isConnected ? 'Supabase Cloud Live' : 'Local Mode (Click for DB)';
        }
        if (modalBadge) {
          modalBadge.textContent = isConnected ? 'Connected to Supabase' : 'Local Browser Mode';
          modalBadge.className = isConnected
            ? 'px-2 py-0.5 rounded text-[10px] font-mono-num font-bold bg-emerald-100 text-emerald-800'
            : 'px-2 py-0.5 rounded text-[10px] font-mono-num font-bold bg-amber-100 text-amber-800';
        }
      }

      function initSupabaseCloud() {
        let url = HARDCODED_SUPABASE_URL;
        let key = HARDCODED_SUPABASE_ANON_KEY;
        try {
          url = url || localStorage.getItem('khatabites_sb_url') || '';
          key = key || localStorage.getItem('khatabites_sb_key') || '';
        } catch (e) {}

        const urlInput = document.getElementById('supabaseUrlInput');
        const keyInput = document.getElementById('supabaseKeyInput');
        const inlineUrl = document.getElementById('adminInlineSbUrl');
        const inlineKey = document.getElementById('adminInlineSbKey');
        if (urlInput && url) urlInput.value = url;
        if (keyInput && key) keyInput.value = key;
        if (inlineUrl && url) inlineUrl.value = url;
        if (inlineKey && key) inlineKey.value = key;

        if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
          try {
            supabaseClient = window.supabase.createClient(url, key);
            updateCloudStatusUI(true);
            pullFromSupabaseCloud(false);
          } catch (err) {
            updateCloudStatusUI(false);
          }
        } else {
          updateCloudStatusUI(false);
        }
      }

      function pullFromSupabaseCloud(notifyUser) {
        if (!supabaseClient) {
          if (notifyUser) showToast('Paste your Supabase URL and Anon Key first!');
          return;
        }
        supabaseClient
          .from('khata_cloud_store')
          .select('payload')
          .eq('room_key', CLOUD_ROOM_KEY)
          .maybeSingle()
          .then(({ data, error }) => {
            if (!error && data && data.payload && Array.isArray(data.payload.friends)) {
              state = data.payload;
              if (typeof syncActiveGroupToState === 'function') syncActiveGroupToState();
              syncMealFormSquadControls(false);
              renderAll();
              if (notifyUser) showToast('Synced latest khata from Supabase Cloud Database!');
            } else if (!error && !data) {
              // Seed initial state into cloud table
              saveState();
              if (notifyUser) showToast('Initialized your Supabase Cloud Database with current khata!');
            } else if (error && notifyUser) {
              showToast('Supabase error: ' + error.message);
            }
          })
          .catch(() => {});
      }

      function showToast(message) {
        const banner = document.getElementById('toastBanner');
        const text = document.getElementById('toastText');
        if (!banner || !text) return;
        text.textContent = message;
        banner.classList.remove('hidden');
        if (window._khataToastTimer) clearTimeout(window._khataToastTimer);
        window._khataToastTimer = setTimeout(() => {
          banner.classList.add('hidden');
        }, 3200);
      }

      function formatMoney(num) {
        const rounded = Math.round(Number(num) || 0);
        const sign = rounded < 0 ? '-' : '';
        return sign + state.currency + ' ' + Math.abs(rounded).toLocaleString('en-US');
      }

      function getActiveUserId() {
        if (state.loggedInUserId && state.friends.some(f => f.id === state.loggedInUserId)) {
          return state.loggedInUserId;
        }
        const fallback = state.friends[0] ? state.friends[0].id : 'f1';
        state.loggedInUserId = fallback;
        return fallback;
      }

      function getFriend(id) {
        return state.friends.find(f => f.id === id) || { id, name: 'Unknown', room: 'Hostel', walletApp: 'SadaPay', walletNum: '-', color: '#52525B' };
      }

      // Compute exact per-meal share math
      function computeMealMath(meal) {
        const totalBill = Number(meal.totalBill) || 0;
        const eaterIds = Array.isArray(meal.eaterIds) ? meal.eaterIds : [];
        const soloItems = Array.isArray(meal.soloItems) ? meal.soloItems : [];

        const soloTotal = soloItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
        const sharedPool = Math.max(0, totalBill - soloTotal);
        const eatersCount = eaterIds.length;
        const basePerEater = eatersCount > 0 ? sharedPool / eatersCount : 0;

        // Map each friend involved (either as eater or solo orderer)
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
      }

      // Compute overall squad ledger & simplified minimum transfers
      function computeSquadLedger() {
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
          const math = computeMealMath(meal);
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

        // Simplify debts (greedy matching of largest debtor to largest creditor)
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
      }

      // Render Top Perspective Selector & Currency Labels (Strictly Private to Logged-In User)
      function renderHeaderControls() {
        const myId = getActiveUserId();
        state.perspectiveId = myId;
        const me = getFriend(myId);

        const privLabel = document.getElementById('privacyActiveUserLabel');
        if (privLabel) privLabel.textContent = `${me.name} (${me.room})`;

        const perspSelect = document.getElementById('perspectiveSelect');
        if (perspSelect) {
          let html = '';
          state.friends.forEach(f => {
            html += `<option value="${f.id}">${f.name} (${f.room}) - Private View</option>`;
          });
          perspSelect.innerHTML = html;
          perspSelect.value = myId;
        }

        const currSelect = document.getElementById('currencySelect');
        if (currSelect) currSelect.value = state.currency;

        document.querySelectorAll('.currency-label').forEach(el => {
          el.textContent = state.currency;
        });
      }

      // Render KPI Cards & Squad Ribbon (Strictly Private to Logged-In User)
      function renderKPIsAndRibbon(summary) {
        const myId = getActiveUserId();
        const myEntry = summary.ledger[myId] || { billsPaid: 0, totalConsumed: 0, soloConsumed: 0, netBalance: 0 };
        const myTransfers = summary.simplifiedTransfers.filter(t => t.fromId === myId || t.toId === myId);
        const myUnsettledTotal = myTransfers.reduce((sum, t) => sum + t.amount, 0);
        const mySettlements = state.settlements.filter(s => s.fromId === myId || s.toId === myId);
        const mySettledTotal = mySettlements.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        const myScreenshots = mySettlements.filter(s => s.mode === 'screenshot').length;
        const myVerbal = mySettlements.length - myScreenshots;

        const myMealsCount = state.meals.filter(m => {
          const math = computeMealMath(m);
          return m.payerId === myId || Boolean(math.sharesByFriend[myId]);
        }).length;

        document.getElementById('kpiMealsCount').textContent = `${myMealsCount} meals`;
        document.getElementById('kpiTotalSpent').textContent = formatMoney(myEntry.totalConsumed);
        document.getElementById('kpiSoloSubtext').textContent = `Your solo orders: ${formatMoney(myEntry.soloConsumed)}`;

        document.getElementById('kpiActiveDebtsCount').textContent = `${myTransfers.length} active`;
        document.getElementById('kpiUnsettledPool').textContent = formatMoney(myUnsettledTotal);

        document.getElementById('kpiSettlementsCount').textContent = `${mySettlements.length} yours`;
        document.getElementById('kpiTotalSettled').textContent = formatMoney(mySettledTotal);
        document.getElementById('kpiProofBreakdown').textContent = `${myScreenshots} screenshots | ${myVerbal} told`;

        // Perspective Card (Always Your Private Standing)
        const pTitle = document.getElementById('kpiPerspectiveTitle');
        const pRoom = document.getElementById('kpiPerspectiveRoom');
        const pNet = document.getElementById('kpiPerspectiveNet');
        const pHint = document.getElementById('kpiPerspectiveHint');

        const me = getFriend(myId);
        const net = Math.round(myEntry.netBalance);
        pTitle.textContent = `${me.name}'s Net`;
        pRoom.textContent = me.room;
        if (net > 1) {
          pNet.textContent = '+' + formatMoney(net);
          pNet.className = 'mt-2 font-mono-num font-bold text-xl sm:text-2xl text-emerald-600';
          pHint.textContent = `You receive ${formatMoney(net)} net`;
        } else if (net < -1) {
          pNet.textContent = formatMoney(net);
          pNet.className = 'mt-2 font-mono-num font-bold text-xl sm:text-2xl text-rose-600';
          pHint.textContent = `You owe ${formatMoney(Math.abs(net))} net`;
        } else {
          pNet.textContent = 'Settled Up';
          pNet.className = 'mt-2 font-mono-num font-bold text-xl sm:text-2xl text-muted';
          pHint.textContent = 'Zero pending balance';
        }

        // Render Squad Ribbon Cards (Only show pairwise relationship with logged-in user; mask third-party balances!)
        const ribbon = document.getElementById('friendsRibbon');
        ribbon.innerHTML = state.friends.map(f => {
          const isMe = f.id === myId;
          const oweThem = myTransfers.find(t => t.fromId === myId && t.toId === f.id);
          const owesMe = myTransfers.find(t => t.fromId === f.id && t.toId === myId);

          let statusBadge = `<span class="text-[11px] font-mono-num font-medium text-subtle">Private</span>`;
          let subLabel = 'settled with you';
          if (isMe) {
            statusBadge = `<span class="text-xs font-mono-num font-bold text-ink">${net > 0 ? '+' : ''}${formatMoney(net)}</span>`;
            subLabel = 'your account';
          } else if (oweThem) {
            statusBadge = `<span class="text-xs font-mono-num font-bold text-rose-600">You owe ${formatMoney(oweThem.amount)}</span>`;
            subLabel = 'direct with you';
          } else if (owesMe) {
            statusBadge = `<span class="text-xs font-mono-num font-bold text-emerald-600">Owes you ${formatMoney(owesMe.amount)}</span>`;
            subLabel = 'direct with you';
          }

          return `
            <div class="rounded-xl p-3.5 border transition flex flex-col justify-between gap-2 ${isMe ? 'bg-zinc-900/5 border-zinc-900' : 'bg-surface hover:bg-oat/50 border-[#E5E0D8]'}" data-friend-card="${f.id}">
              <div class="flex items-start justify-between gap-2 cursor-pointer select-friend-trigger" data-friend-id="${f.id}">
                <div class="flex items-center gap-2.5 min-w-0">
                  <span class="w-7 h-7 rounded-lg text-white font-display font-bold text-xs flex items-center justify-center shrink-0" style="background-color: ${f.color}">
                    ${f.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div class="truncate">
                    <div class="font-display font-semibold text-xs text-ink truncate">${f.name} ${isMe ? '(You)' : ''}</div>
                    <div class="text-[10px] text-muted truncate">${f.room}</div>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  ${statusBadge}
                  <div class="text-[10px] text-subtle">${subLabel}</div>
                </div>
              </div>
              <div class="pt-2 border-t border-zinc-100 flex items-center justify-between gap-1 text-[10px] text-muted">
                <span class="truncate font-mono-num">${f.walletApp}: ${f.walletNum}</span>
                <button type="button" class="copy-wallet-btn shrink-0 px-2 py-0.5 rounded bg-oat hover:bg-zinc-200 text-ink font-medium" data-wallet="${f.walletNum}" data-name="${f.name}" data-app="${f.walletApp}">
                  Copy
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      // Render 1-Tap Payer Avatar Pills
      function renderPayerQuickPills() {
        const payerSelect = document.getElementById('mealPayer');
        const pillContainer = document.getElementById('payerQuickPills');
        if (!payerSelect || !pillContainer) return;
        const activePayerId = payerSelect.value;
        pillContainer.innerHTML = state.friends.map(f => {
          const isSelected = f.id === activePayerId;
          return `
            <button type="button" data-select-payer="${f.id}" class="px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 border ${isSelected ? 'bg-terracotta-600 text-white border-terracotta-600 shadow-xs' : 'bg-canvas hover:bg-oat text-ink border-[#E5E0D8]'}">
              <span class="w-5 h-5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center" style="background-color: ${isSelected ? 'rgba(255,255,255,0.25)' : f.color}">${f.name.slice(0, 2).toUpperCase()}</span>
              <span>${f.name}</span>
            </button>
          `;
        }).join('');
      }

      // Populate Meal Form Controls (Payer dropdown & Eaters checkboxes)
      function syncMealFormSquadControls(preserveChecks = true) {
        const payerSelect = document.getElementById('mealPayer');
        const prevPayer = payerSelect.value || (state.friends[0] && state.friends[0].id);
        payerSelect.innerHTML = state.friends.map(f => `<option value="${f.id}">${f.name} (${f.room})</option>`).join('');
        if (state.friends.some(f => f.id === prevPayer)) {
          payerSelect.value = prevPayer;
        }
        renderPayerQuickPills();

        const eatersGrid = document.getElementById('eatersCheckboxGrid');
        const existingChecked = Array.from(eatersGrid.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        const activeEaterIds = (preserveChecks && existingChecked.length > 0)
          ? existingChecked
          : state.friends.map(f => f.id);

        eatersGrid.innerHTML = state.friends.map(f => {
          const checked = activeEaterIds.includes(f.id);
          return `
            <label class="eater-pill cursor-pointer flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border text-xs font-bold transition select-none ${checked ? 'bg-emerald-50/90 border-emerald-600 text-emerald-950 shadow-2xs' : 'bg-canvas border-[#E5E0D8] text-muted'}">
              <input type="checkbox" value="${f.id}" ${checked ? 'checked' : ''} class="eater-checkbox accent-emerald-600 w-4 h-4 rounded cursor-pointer" />
              <span class="truncate">${f.name}</span>
            </label>
          `;
        }).join('');

        renderSoloItemRows();
        updateLiveSplitPreview();
      }

      // Render Dynamic Solo / Personal Item Rows inside the Meal Form
      function renderSoloItemRows() {
        const container = document.getElementById('soloItemsContainer');
        if (draftSoloItems.length === 0) {
          container.innerHTML = `
            <div class="text-xs text-muted italic bg-white/70 rounded-lg px-3 py-2 border border-dashed border-zinc-300">
              No solo items added - entire bill will be divided equally among selected eaters.
            </div>
          `;
          return;
        }

        container.innerHTML = draftSoloItems.map((row, idx) => {
          const options = state.friends.map(f => `<option value="${f.id}" ${f.id === row.friendId ? 'selected' : ''}>${f.name}</option>`).join('');
          return `
            <div class="grid grid-cols-12 gap-1.5 items-center bg-white p-2 rounded-xl border border-zinc-200 shadow-2xs" data-solo-index="${idx}">
              <div class="col-span-4">
                <select data-solo-field="friendId" data-idx="${idx}" class="w-full px-2 py-1.5 rounded-lg border border-zinc-300 text-xs font-semibold text-ink bg-canvas">
                  ${options}
                </select>
              </div>
              <div class="col-span-5">
                <input type="text" data-solo-field="item" data-idx="${idx}" value="${escapeHtml(row.item || '')}" placeholder="Solo item (e.g. Zinger)" class="w-full px-2 py-1.5 rounded-lg border border-zinc-300 text-xs text-ink" />
              </div>
              <div class="col-span-2">
                <input type="number" min="0" step="1" data-solo-field="amount" data-idx="${idx}" value="${row.amount || ''}" placeholder="Rs." class="w-full px-2 py-1.5 rounded-lg border border-zinc-300 font-mono-num font-bold text-xs text-ink" />
              </div>
              <div class="col-span-1 flex justify-end">
                <button type="button" data-remove-solo="${idx}" class="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center" title="Remove solo item">Close</button>
              </div>
            </div>
          `;
        }).join('');
      }

      // Live Math Preview in Left Studio
      function updateLiveSplitPreview() {
        const totalBillInput = document.getElementById('mealTotalBill');
        const payerId = document.getElementById('mealPayer').value;
        const totalBill = Number(totalBillInput.value) || 0;
        const checkedEaters = Array.from(document.querySelectorAll('.eater-checkbox:checked')).map(cb => cb.value);

        document.getElementById('selectedEatersCount').textContent = checkedEaters.length;

        // Update pill styling
        document.querySelectorAll('.eater-pill').forEach(label => {
          const cb = label.querySelector('input[type="checkbox"]');
          if (cb && cb.checked) {
            label.className = 'eater-pill cursor-pointer flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border text-xs font-bold transition select-none bg-emerald-50/90 border-emerald-600 text-emerald-950 shadow-2xs';
          } else {
            label.className = 'eater-pill cursor-pointer flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border text-xs font-bold transition select-none bg-canvas border-[#E5E0D8] text-muted';
          }
        });

        const draftMeal = {
          payerId,
          totalBill,
          eaterIds: checkedEaters,
          soloItems: draftSoloItems
        };
        const math = computeMealMath(draftMeal);

        document.getElementById('previewTotalBill').textContent = formatMoney(math.totalBill);
        document.getElementById('previewSoloTotal').textContent = formatMoney(math.soloTotal);
        document.getElementById('previewSharedPool').textContent = formatMoney(math.sharedPool);
        document.getElementById('previewBasePerEater').textContent = `${formatMoney(math.basePerEater)} for ${math.eatersCount} eaters`;

        const badge = document.getElementById('liveFormulaBadge');
        const errBox = document.getElementById('formValidationError');
        errBox.classList.add('hidden');

        if (math.soloTotal > math.totalBill && math.totalBill > 0) {
          badge.textContent = 'Solo > Total Bill!';
          badge.className = 'text-xs font-mono-num px-2 py-0.5 rounded bg-red-900 text-red-200';
        } else if (math.eatersCount === 0) {
          badge.textContent = 'Select Eater';
          badge.className = 'text-xs font-mono-num px-2 py-0.5 rounded bg-amber-900 text-amber-200';
        } else {
          badge.textContent = `${math.eatersCount} Eating`;
          badge.className = 'text-xs font-mono-num px-2 py-0.5 rounded bg-zinc-800 text-emerald-400';
        }

        const listEl = document.getElementById('previewPerPersonList');
        const involvedIds = Object.keys(math.sharesByFriend);
        if (involvedIds.length === 0 || math.totalBill <= 0) {
          listEl.innerHTML = `<div class="text-xs text-zinc-400 italic py-1">Enter total bill amount above to see each friend's exact share.</div>`;
          return;
        }

        listEl.innerHTML = involvedIds.map(fid => {
          const f = getFriend(fid);
          const share = math.sharesByFriend[fid];
          const isPayer = fid === payerId;
          const formulaParts = [];
          if (share.isEater) formulaParts.push(`${formatMoney(share.sharedBase)} shared`);
          if (share.soloAmount > 0) formulaParts.push(`+ ${formatMoney(share.soloAmount)} solo (${share.soloDescriptions.join(', ') || 'extra'})`);

          return `
            <div class="flex items-center justify-between text-xs py-1 px-2 rounded bg-zinc-900/60">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-semibold text-white truncate">${f.name}</span>
                ${isPayer ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-900/80 text-emerald-300 font-semibold">Paid Bill</span>` : ''}
                <span class="text-[11px] text-zinc-400 truncate">(${formulaParts.join(' ')})</span>
              </div>
              <span class="font-mono-num font-bold text-amber-300 shrink-0 ml-2">${formatMoney(share.totalShare)}</span>
            </div>
          `;
        }).join('');
      }

      // Render Right Panel Tabs & Lists (Strictly Enforcing Personal Balance Privacy)
      function renderRightWorkspace(summary) {
        const myId = getActiveUserId();
        const me = getFriend(myId);
        const searchQuery = (document.getElementById('ledgerSearchInput').value || '').trim().toLowerCase();

        // STRICT PRIVACY: Only transfers where loggedInUser is sender or receiver
        const hiddenThirdPartyCount = summary.simplifiedTransfers.filter(t => t.fromId !== myId && t.toId !== myId).length;
        const filteredTransfers = summary.simplifiedTransfers.filter(t => {
          if (t.fromId !== myId && t.toId !== myId) return false;
          if (!searchQuery) return true;
          const fromName = getFriend(t.fromId).name.toLowerCase();
          const toName = getFriend(t.toId).name.toLowerCase();
          return fromName.includes(searchQuery) || toName.includes(searchQuery);
        });

        // STRICT PRIVACY: Only meals involving loggedInUser
        const filteredMeals = state.meals.filter(m => {
          const math = computeMealMath(m);
          const involved = m.payerId === myId || Boolean(math.sharesByFriend[myId]);
          if (!involved) return false;
          if (!searchQuery) return true;
          const payerName = getFriend(m.payerId).name.toLowerCase();
          return m.title.toLowerCase().includes(searchQuery) || m.tag.toLowerCase().includes(searchQuery) || payerName.includes(searchQuery);
        });

        // STRICT PRIVACY: Only settlements involving loggedInUser
        const filteredSettlements = state.settlements.filter(s => {
          if (s.fromId !== myId && s.toId !== myId) return false;
          if (!searchQuery) return true;
          const fromName = getFriend(s.fromId).name.toLowerCase();
          const toName = getFriend(s.toId).name.toLowerCase();
          return fromName.includes(searchQuery) || toName.includes(searchQuery) || (s.method || '').toLowerCase().includes(searchQuery) || (s.note || '').toLowerCase().includes(searchQuery);
        });

        // Update tab badges
        document.getElementById('badgeOwesCount').textContent = filteredTransfers.length;
        document.getElementById('badgeMealsCount').textContent = filteredMeals.length;
        document.getElementById('badgeSettlementsCount').textContent = filteredSettlements.length;

        // Show active tab panel
        document.querySelectorAll('.tab-btn').forEach(btn => {
          const isAct = btn.getAttribute('data-tab') === state.activeTab;
          btn.className = isAct
            ? 'tab-btn px-3.5 py-1.5 rounded-lg text-xs font-bold transition bg-white text-ink shadow-sm'
            : 'tab-btn px-3.5 py-1.5 rounded-lg text-xs font-bold transition text-muted hover:text-ink';
        });
        const isSettlementsTab = state.activeTab === 'settlements';
        document.getElementById('tabPanelOwes').classList.remove('hidden');
        document.getElementById('tabPanelMeals').classList.toggle('hidden', isSettlementsTab);
        document.getElementById('tabPanelSettlements').classList.toggle('hidden', !isSettlementsTab);

        // 1. Render Active Personal Debts List (Strictly Private)
        const debtsListEl = document.getElementById('activeDebtsList');
        const privacyFooter = hiddenThirdPartyCount > 0
          ? `<div class="pt-2 flex items-center justify-between text-[11px] text-subtle border-t border-zinc-100">
               <span>${hiddenThirdPartyCount} other transfer(s) between other friends are hidden for privacy.</span>
               <span class="font-mono-num">Viewing as ${escapeHtml(me.name)}</span>
             </div>`
          : '';

        if (filteredTransfers.length === 0) {
          debtsListEl.innerHTML = `
            <div class="rounded-xl bg-canvas border border-[#E5E0D8] p-5 text-center space-y-1">
              <div class="text-sm font-display font-semibold text-ink">You are 100% settled up, ${escapeHtml(me.name)}!</div>
              <p class="text-xs text-muted">You don't owe anyone and no one owes you right now.</p>
            </div>
            ${privacyFooter}
          `;
        } else {
          debtsListEl.innerHTML = filteredTransfers.map(t => {
            const sender = getFriend(t.fromId);
            const receiver = getFriend(t.toId);
            const iAmDebtor = t.fromId === myId;
            return `
              <div class="p-3.5 rounded-xl bg-canvas border border-[#E5E0D8] hover:border-zinc-300 flex flex-wrap items-center justify-between gap-3 transition">
                <div class="flex items-center gap-3">
                  <span class="w-8 h-8 rounded-lg text-white font-display font-bold text-xs flex items-center justify-center shrink-0 ${iAmDebtor ? 'bg-zinc-900' : 'bg-emerald-600'}">
                    ${(iAmDebtor ? receiver.name : sender.name).slice(0,2).toUpperCase()}
                  </span>
                  <div>
                    <div class="text-xs sm:text-sm font-semibold text-ink">
                      ${iAmDebtor
                        ? `<span class="font-bold text-rose-600">You (${escapeHtml(sender.name)})</span> <span class="text-muted mx-1">owe</span> <span class="font-bold text-ink">${escapeHtml(receiver.name)}</span>`
                        : `<span class="font-bold text-ink">${escapeHtml(sender.name)}</span> <span class="text-muted mx-1">owes</span> <span class="font-bold text-emerald-700">You (${escapeHtml(receiver.name)})</span>`
                      }
                    </div>
                    <div class="text-[11px] text-muted font-mono-num">
                      ${iAmDebtor
                        ? `Send to ${receiver.walletApp}: <span class="font-semibold text-ink">${receiver.walletNum}</span>`
                        : `Receive on your ${receiver.walletApp}: <span class="font-semibold text-ink">${receiver.walletNum}</span>`
                      }
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2.5 ml-auto">
                  <span class="font-mono-num font-bold text-base ${iAmDebtor ? 'text-rose-600' : 'text-emerald-600'}">${iAmDebtor ? '-' : '+'}${formatMoney(t.amount)}</span>
                  <button type="button" class="btn-quick-settle px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink hover:bg-zinc-800 text-white transition" data-from="${t.fromId}" data-to="${t.toId}" data-amount="${t.amount}">
                    Settle Up
                  </button>
                </div>
              </div>
            `;
          }).join('') + privacyFooter;
        }

        // Render Privacy-Masked Audit Table (Only logged-in user's row is visible; others are masked)
        const auditBody = document.getElementById('accountAuditTableBody');
        auditBody.innerHTML = state.friends.map(f => {
          const isMe = f.id === myId;
          const row = summary.ledger[f.id];
          if (!isMe) {
            return `
              <tr class="text-subtle bg-zinc-50/50">
                <td class="py-2.5 pr-3 font-medium text-muted">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-zinc-300"></span>
                    <span>${escapeHtml(f.name)}</span>
                    <span class="text-[10px] text-subtle font-normal">(${escapeHtml(f.room)})</span>
                  </div>
                </td>
                <td class="py-2.5 px-3 text-right font-mono-num text-[11px]">Private</td>
                <td class="py-2.5 px-3 text-right font-mono-num text-[11px]">Private</td>
                <td class="py-2.5 px-3 text-right font-mono-num text-[11px]">Private</td>
                <td class="py-2.5 pl-3 text-right font-mono-num text-[11px]">Private</td>
              </tr>
            `;
          }
          const net = Math.round(row.netBalance);
          const netClass = net > 1 ? 'text-emerald-600 font-bold' : net < -1 ? 'text-rose-600 font-bold' : 'text-subtle';
          const netPrefix = net > 1 ? '+' : '';
          const netTransfer = Math.round(row.settlementsSent - row.settlementsReceived);
          return `
            <tr class="bg-white font-medium">
              <td class="py-3 pr-3 font-semibold text-ink">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-ink"></span>
                  <span>${escapeHtml(f.name)} (You)</span>
                  <span class="text-[10px] text-subtle font-normal">(${escapeHtml(f.room)})</span>
                </div>
              </td>
              <td class="py-3 px-3 text-right font-mono-num text-ink">${formatMoney(row.billsPaid)}</td>
              <td class="py-3 px-3 text-right font-mono-num text-ink">
                ${formatMoney(row.totalConsumed)}
                ${row.soloConsumed > 0 ? `<span class="block text-[10px] text-muted">(${formatMoney(row.soloConsumed)} solo)</span>` : ''}
              </td>
              <td class="py-3 px-3 text-right font-mono-num text-muted">${netTransfer >= 0 ? '+' : ''}${formatMoney(netTransfer)}</td>
              <td class="py-3 pl-3 text-right font-mono-num ${netClass}">${netPrefix}${formatMoney(net)}</td>
            </tr>
          `;
        }).join('');

        // 2. Render Meals Feed (Mask other eaters' individual shares unless you paid the bill)
        const mealsContainer = document.getElementById('mealsFeedContainer');
        if (filteredMeals.length === 0) {
          mealsContainer.innerHTML = `
            <div class="bg-surface rounded-xl p-8 border border-[#E5E0D8] text-center text-xs text-muted">
              No meal bills involving your account yet. Use "Split a Meal Bill" to log a meal!
            </div>
          `;
        } else {
          mealsContainer.innerHTML = filteredMeals.map(meal => {
            const payer = getFriend(meal.payerId);
            const iPaidThisMeal = meal.payerId === myId;
            const math = computeMealMath(meal);
            const myShareObj = math.sharesByFriend[myId];

            const visibleSoloItems = (meal.soloItems || []).filter(s => iPaidThisMeal || s.friendId === myId);
            const soloBadges = visibleSoloItems.map(s => {
              const sf = getFriend(s.friendId);
              return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-oat text-ink border border-zinc-200 text-[11px] font-medium">
                <strong>${sf.id === myId ? 'You' : escapeHtml(sf.name)}:</strong> ${escapeHtml(s.item || 'Solo extra')} (<span class="font-mono-num font-bold">${formatMoney(s.amount)}</span>)
              </span>`;
            }).join('');

            const sharePills = Object.keys(math.sharesByFriend).map(fid => {
              const f = getFriend(fid);
              const sh = math.sharesByFriend[fid];
              const canViewShare = (fid === myId) || iPaidThisMeal;
              if (!canViewShare) {
                return `
                  <div class="px-2.5 py-1.5 rounded-lg border bg-zinc-50 border-zinc-200/60 flex items-center justify-between gap-2 text-xs text-subtle">
                    <span class="truncate font-medium">${escapeHtml(f.name)}</span>
                    <span class="font-mono-num text-[11px] shrink-0">Private</span>
                  </div>
                `;
              }
              const hasSolo = sh.soloAmount > 0;
              return `
                <div class="px-2.5 py-1.5 rounded-lg border ${fid === myId ? 'bg-zinc-900/5 border-zinc-900' : 'bg-canvas border-[#E5E0D8]'} flex items-center justify-between gap-2 text-xs">
                  <div class="truncate">
                    <span class="font-semibold text-ink">${escapeHtml(f.name)} ${fid === myId ? '(You)' : ''}</span>
                    ${hasSolo ? `<span class="text-[10px] text-muted block">${formatMoney(sh.sharedBase)} base + ${formatMoney(sh.soloAmount)} solo</span>` : `<span class="text-[10px] text-subtle block">Shared base</span>`}
                  </div>
                  <span class="font-mono-num font-bold text-ink shrink-0">${formatMoney(sh.totalShare)}</span>
                </div>
              `;
            }).join('');

            return `
              <article class="bg-surface rounded-xl p-5 border border-[#E5E0D8] space-y-3.5">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="px-2 py-0.5 rounded-md bg-oat text-[11px] font-medium text-muted">${escapeHtml(meal.tag)}</span>
                      <span class="text-[11px] text-subtle">${escapeHtml(meal.timestamp)}</span>
                    </div>
                    <h4 class="font-display font-bold text-base text-ink mt-1">${escapeHtml(meal.title)}</h4>
                  </div>
                  <div class="text-right">
                    <div class="text-[11px] text-muted">Paid by <strong class="text-ink">${payer.id === myId ? 'You (' + escapeHtml(payer.name) + ')' : escapeHtml(payer.name)}</strong></div>
                    <div class="font-mono-num font-bold text-base text-ink">Total: ${formatMoney(math.totalBill)}${myShareObj ? ` | Your Share: ${formatMoney(myShareObj.totalShare)}` : ''}</div>
                  </div>
                </div>

                <!-- Minimal Formula Bar -->
                <div class="p-2.5 rounded-lg bg-canvas border border-[#E5E0D8] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div class="font-mono-num text-muted">
                    Shared Pool: <strong class="text-ink">${formatMoney(math.sharedPool)}</strong> (${math.eatersCount} eaters)
                  </div>
                  <div class="font-mono-num font-semibold text-ink">
                    ${formatMoney(math.basePerEater)} / eater base
                  </div>
                </div>

                ${soloBadges ? `<div class="space-y-1"><div class="text-[11px] font-semibold uppercase tracking-wider text-subtle">Visible Solo Orders:</div><div class="flex flex-wrap gap-1.5">${soloBadges}</div></div>` : ''}

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  ${sharePills}
                </div>

                <div class="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-subtle">
                  <span>Other members' personal shares are visible only to them and the bill payer</span>
                  <button type="button" class="delete-meal-btn text-rose-600 hover:underline font-medium" data-meal-id="${meal.id}">Remove Entry</button>
                </div>
              </article>
            `;
          }).join('');
        }

        // 3. Render Private Settlements & Screenshots Log
        const settlementsContainer = document.getElementById('settlementsFeedContainer');
        if (filteredSettlements.length === 0) {
          settlementsContainer.innerHTML = `
            <div class="bg-surface rounded-xl p-8 border border-[#E5E0D8] text-center text-xs text-muted">
              No payment screenshots or verbal settlements involving your account yet.
            </div>
          `;
        } else {
          settlementsContainer.innerHTML = filteredSettlements.map(s => {
            const sender = getFriend(s.fromId);
            const receiver = getFriend(s.toId);
            const isScreenshot = s.mode === 'screenshot';

            return `
              <div class="bg-surface rounded-xl p-4 border border-[#E5E0D8] flex flex-wrap items-center justify-between gap-4">
                <div class="flex items-start gap-3">
                  <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-[11px] bg-oat text-ink border border-zinc-200">
                    ${isScreenshot ? 'IMG' : 'TOLD'}
                  </div>
                  <div class="space-y-0.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-semibold text-ink">${sender.id === myId ? 'You' : escapeHtml(sender.name)} paid ${receiver.id === myId ? 'You' : escapeHtml(receiver.name)}</span>
                      <span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-oat text-ink">
                        ${escapeHtml(s.method)}
                      </span>
                      <span class="text-[11px] text-subtle">${escapeHtml(s.timestamp)}</span>
                    </div>
                    <p class="text-xs text-muted">${escapeHtml(s.note || 'Settled balance')}</p>
                  </div>
                </div>

                <div class="flex items-center gap-2.5 ml-auto">
                  <span class="font-mono-num font-bold text-base text-emerald-600">${formatMoney(s.amount)}</span>
                  <button type="button" class="view-proof-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-oat hover:bg-zinc-200/70 text-ink transition" data-settlement-id="${s.id}">
                    ${isScreenshot ? 'View Screenshot' : 'View / Verify'}
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      function renderAll() {
        renderHeaderControls();
        const summary = computeSquadLedger();
        renderKPIsAndRibbon(summary);
        renderRightWorkspace(summary);
        if (typeof renderMultiGroupAndAccountBar === 'function') {
          renderMultiGroupAndAccountBar();
        }
      }

      function escapeHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      // Open Settle Modal pre-filled with Sender, Receiver, and Amount
      function openSettleModal(fromId, toId, amount) {
        const fromSel = document.getElementById('settleFrom');
        const toSel = document.getElementById('settleTo');

        const opts = state.friends.map(f => `<option value="${f.id}">${f.name} (${f.room})</option>`).join('');
        fromSel.innerHTML = opts;
        toSel.innerHTML = opts;

        fromSel.value = fromId || (state.friends[1] ? state.friends[1].id : state.friends[0].id);
        toSel.value = toId || state.friends[0].id;
        if (fromSel.value === toSel.value && state.friends.length > 1) {
          toSel.value = state.friends.find(f => f.id !== fromSel.value).id;
        }

        document.getElementById('settleAmount').value = amount || 500;
        document.getElementById('settleNote').value = '';
        document.getElementById('settleScreenshotInput').value = '';
        draftUploadedScreenshotDataUrl = null;
        document.getElementById('uploadedScreenshotPreviewWrap').classList.add('hidden');
        document.getElementById('settleErrorMsg').classList.add('hidden');

        updateReceiverWalletBanner();
        document.getElementById('settleModal').classList.remove('hidden');
      }

      function updateReceiverWalletBanner() {
        const toId = document.getElementById('settleTo').value;
        const receiver = getFriend(toId);
        document.getElementById('receiverWalletLabel').textContent = `Send to ${receiver.name}'s ${receiver.walletApp}:`;
        document.getElementById('receiverWalletNumber').textContent = `${receiver.walletApp} | ${receiver.walletNum}`;
      }

      // Open Screenshot / Proof Modal
      function openProofModal(settlementId) {
        const s = state.settlements.find(item => item.id === settlementId);
        if (!s) return;
        const sender = getFriend(s.fromId);
        const receiver = getFriend(s.toId);
        const isScreenshot = s.mode === 'screenshot';

        const body = document.getElementById('proofModalBody');
        const visualSlip = s.customImage
          ? `<img src="${s.customImage}" alt="Payment Screenshot" class="max-h-72 mx-auto rounded-xl border border-zinc-300 object-contain" />`
          : isScreenshot
            ? `
              <div class="rounded-2xl bg-gradient-to-b from-emerald-900 to-zinc-900 text-white p-5 space-y-3 border border-emerald-700 shadow-inner">
                <div class="flex items-center justify-between border-b border-emerald-800 pb-2.5">
                  <span class="text-xs font-bold uppercase tracking-wider text-emerald-300">${escapeHtml(s.method)}</span>
                  <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono-num">SUCCESS | VERIFIED</span>
                </div>
                <div class="text-center py-2">
                  <div class="text-[11px] text-zinc-300">Amount Transferred</div>
                  <div class="font-mono-num font-extrabold text-2xl text-white mt-0.5">${formatMoney(s.amount)}</div>
                </div>
                <div class="space-y-1.5 text-xs bg-black/30 rounded-xl p-3 font-mono-num">
                  <div class="flex justify-between"><span class="text-zinc-400">From:</span><span>${sender.name} (${sender.room})</span></div>
                  <div class="flex justify-between"><span class="text-zinc-400">To:</span><span>${receiver.name} (${receiver.walletNum})</span></div>
                  <div class="flex justify-between"><span class="text-zinc-400">Time:</span><span>${escapeHtml(s.timestamp)}</span></div>
                </div>
              </div>
            `
            : `
              <div class="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-2 text-amber-950">
                <div class="text-xs font-bold uppercase tracking-wider text-amber-700">Verbal / In-Person Hostel Confirmation</div>
                <p class="text-sm font-semibold">"${escapeHtml(s.note || 'Told in person at hostel/uni')}"</p>
                <p class="text-xs text-amber-800">Logged between ${sender.name} and ${receiver.name} on ${escapeHtml(s.timestamp)}.</p>
              </div>
            `;

        body.innerHTML = `
          ${visualSlip}
          <div class="text-xs text-muted bg-canvas p-3 rounded-xl border border-[#E5E0D8]">
            <strong>Note / Reference:</strong> ${escapeHtml(s.note || 'No additional note')}
          </div>
          <div class="flex items-center justify-between pt-2">
            <button type="button" id="btnDeleteSettlementModal" data-del-settlement="${s.id}" class="text-xs font-semibold text-red-600 hover:underline">
              Delete Record
            </button>
            <button type="button" id="btnDoneProofModal" class="px-4 py-2 rounded-xl text-xs font-bold bg-ink text-white">
              Done
            </button>
          </div>
        `;

        document.getElementById('proofLightboxModal').classList.remove('hidden');
      }

      // Copy helper with fallback
      function copyTextToClipboard(text, successMsg) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showToast(successMsg)).catch(() => fallbackCopy(text, successMsg));
            return;
          }
        } catch (e) {}
        fallbackCopy(text, successMsg);
      }

      function fallbackCopy(text, successMsg) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          showToast(successMsg);
        } catch (err) {
          showToast('Copied: ' + text);
        }
        document.body.removeChild(ta);
      }

      // Wire up DOM Event Listeners
      function initEvents() {
        // Perspective & Currency (Switching switches active private student account)
        document.getElementById('perspectiveSelect').addEventListener('change', (e) => {
          state.loggedInUserId = e.target.value;
          state.perspectiveId = e.target.value;
          saveState();
          renderAll();
          if (typeof switchToPage === 'function') switchToPage(state.activePage || 'dashboard');
          showToast(`Viewing private khata as ${getFriend(state.loggedInUserId).name}`);
        });

        document.getElementById('currencySelect').addEventListener('change', (e) => {
          state.currency = e.target.value;
          saveState();
          renderAll();
          updateLiveSplitPreview();
        });

        // Focus Meal Form button -> switches to Page 2 (Split a Meal Bill)
        document.getElementById('btnFocusMealForm').addEventListener('click', () => {
          if (typeof switchToPage === 'function') switchToPage('split');
          const titleEl = document.getElementById('mealTitle');
          if (titleEl) titleEl.focus();
        });

        // Sample Dhaba Preset button (Safe for any number of friends)
        document.getElementById('btnLoadSamplePreset').addEventListener('click', () => {
          document.getElementById('mealTitle').value = 'Butt Karahi & Naan Shop (Hostel Road)';
          document.getElementById('mealTag').value = 'Late Night Hostel';
          document.getElementById('mealTotalBill').value = '1800';
          document.querySelectorAll('.eater-checkbox').forEach((cb) => {
            cb.checked = true;
          });
          const fFirst = state.friends[0] ? state.friends[0].id : 'f1';
          draftSoloItems = [
            { friendId: fFirst, item: 'Special Peshawari Kahwa + Tin', amount: 300 }
          ];
          renderSoloItemRows();
          updateLiveSplitPreview();
          showToast('Filled sample order inputs - review and click Save!');
        });

        // Select All / Clear Eaters
        document.getElementById('btnSelectAllEaters').addEventListener('click', () => {
          document.querySelectorAll('.eater-checkbox').forEach(cb => { cb.checked = true; });
          updateLiveSplitPreview();
        });

        document.getElementById('btnClearEaters').addEventListener('click', () => {
          document.querySelectorAll('.eater-checkbox').forEach(cb => { cb.checked = false; });
          updateLiveSplitPreview();
        });

        // Eaters checkbox change
        document.getElementById('eatersCheckboxGrid').addEventListener('change', (e) => {
          if (e.target.classList.contains('eater-checkbox')) {
            updateLiveSplitPreview();
          }
        });

        // Payer & Total Bill live changes + 1-Tap Quick Spot & Payer Pills
        document.getElementById('mealPayer').addEventListener('change', () => {
          renderPayerQuickPills();
          updateLiveSplitPreview();
        });
        document.getElementById('mealTotalBill').addEventListener('input', updateLiveSplitPreview);

        const payerPillsEl = document.getElementById('payerQuickPills');
        if (payerPillsEl) {
          payerPillsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-select-payer]');
            if (!btn) return;
            document.getElementById('mealPayer').value = btn.getAttribute('data-select-payer');
            renderPayerQuickPills();
            updateLiveSplitPreview();
          });
        }

        const spotChipsEl = document.getElementById('quickSpotChips');
        if (spotChipsEl) {
          spotChipsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-spot]');
            if (!btn) return;
            document.getElementById('mealTitle').value = btn.getAttribute('data-spot');
            document.getElementById('mealTag').value = btn.getAttribute('data-tag');
            document.getElementById('mealTotalBill').focus();
          });
        }

        // Add Solo Item Row
        document.getElementById('btnAddSoloItem').addEventListener('click', () => {
          const defaultFriend = state.friends[0] ? state.friends[0].id : 'f1';
          draftSoloItems.push({ friendId: defaultFriend, item: '', amount: '' });
          renderSoloItemRows();
          updateLiveSplitPreview();
        });

        // Delegate Solo Item edits & removal
        document.getElementById('soloItemsContainer').addEventListener('input', (e) => {
          const field = e.target.getAttribute('data-solo-field');
          const idx = Number(e.target.getAttribute('data-idx'));
          if (field && !Number.isNaN(idx) && draftSoloItems[idx]) {
            draftSoloItems[idx][field] = field === 'amount' ? Number(e.target.value) : e.target.value;
            updateLiveSplitPreview();
          }
        });

        document.getElementById('soloItemsContainer').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-remove-solo]');
          if (btn) {
            const idx = Number(btn.getAttribute('data-remove-solo'));
            draftSoloItems.splice(idx, 1);
            renderSoloItemRows();
            updateLiveSplitPreview();
          }
        });

        // Submit New Meal Split
        document.getElementById('mealSplitForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const title = document.getElementById('mealTitle').value.trim() || 'Hostel Squad Meal';
          const tag = document.getElementById('mealTag').value;
          const payerId = document.getElementById('mealPayer').value;
          const totalBill = Number(document.getElementById('mealTotalBill').value) || 0;
          const eaterIds = Array.from(document.querySelectorAll('.eater-checkbox:checked')).map(cb => cb.value);
          const cleanSolo = draftSoloItems
            .filter(item => Number(item.amount) > 0)
            .map(item => ({
              friendId: item.friendId,
              item: (item.item || 'Personal Order').trim(),
              amount: Number(item.amount)
            }));

          const soloSum = cleanSolo.reduce((s, i) => s + i.amount, 0);
          const errBox = document.getElementById('formValidationError');

          if (totalBill <= 0) {
            errBox.textContent = 'Please enter a valid Total Bill amount greater than 0.';
            errBox.classList.remove('hidden');
            return;
          }
          if (eaterIds.length === 0) {
            errBox.textContent = 'Please check at least 1 friend who ate this meal.';
            errBox.classList.remove('hidden');
            return;
          }
          if (soloSum > totalBill) {
            errBox.textContent = `Solo items (${formatMoney(soloSum)}) cannot exceed the Total Bill (${formatMoney(totalBill)}).`;
            errBox.classList.remove('hidden');
            return;
          }

          errBox.classList.add('hidden');
          const newMeal = {
            id: 'm' + Date.now(),
            title,
            tag,
            timestamp: 'Just now',
            payerId,
            totalBill,
            eaterIds,
            soloItems: cleanSolo
          };

          state.meals.unshift(newMeal);
          saveState();

          // Reset form inputs cleanly
          document.getElementById('mealTitle').value = '';
          document.getElementById('mealTotalBill').value = '';
          draftSoloItems = [];
          renderSoloItemRows();
          updateLiveSplitPreview();
          renderAll();
          if (typeof switchToPage === 'function') switchToPage('dashboard');
          showToast(`Logged "${title}" (${formatMoney(totalBill)})! Showing updated balances.`);
        });

        // Tab Switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            state.activeTab = targetTab;
            if (targetTab === 'owes' && typeof switchToPage === 'function') {
              switchToPage('dashboard');
            }
            saveState();
            renderAll();
          });
        });

        // Search input
        document.getElementById('ledgerSearchInput').addEventListener('input', () => {
          renderAll();
        });

        // Ribbon interactions (Select friend perspective or Copy wallet number)
        document.getElementById('friendsRibbon').addEventListener('click', (e) => {
          const copyBtn = e.target.closest('.copy-wallet-btn');
          if (copyBtn) {
            e.stopPropagation();
            const wallet = copyBtn.getAttribute('data-wallet');
            const name = copyBtn.getAttribute('data-name');
            const app = copyBtn.getAttribute('data-app');
            copyTextToClipboard(wallet, `Copied ${name}'s ${app} number (${wallet})`);
            return;
          }
          const cardTrigger = e.target.closest('.select-friend-trigger');
          if (cardTrigger) {
            const fid = cardTrigger.getAttribute('data-friend-id');
            const targetFriend = getFriend(fid);
            showToast(`${targetFriend.name}'s third-party balances are private. Switch account in Page 5 if you are ${targetFriend.name}.`);
          }
        });

        // Delegate Quick Settle clicks, Meal delete clicks, and Proof modal clicks
        document.addEventListener('click', (e) => {
          const settleBtn = e.target.closest('.btn-quick-settle');
          if (settleBtn) {
            openSettleModal(
              settleBtn.getAttribute('data-from'),
              settleBtn.getAttribute('data-to'),
              Number(settleBtn.getAttribute('data-amount'))
            );
            return;
          }

          const delMealBtn = e.target.closest('.delete-meal-btn');
          if (delMealBtn) {
            const mid = delMealBtn.getAttribute('data-meal-id');
            state.meals = state.meals.filter(m => m.id !== mid);
            saveState();
            renderAll();
            showToast('Meal entry removed & balances recalculated.');
            return;
          }

          const proofBtn = e.target.closest('.view-proof-btn');
          if (proofBtn) {
            openProofModal(proofBtn.getAttribute('data-settlement-id'));
            return;
          }

          const delSettlementBtn = e.target.closest('[data-del-settlement]');
          if (delSettlementBtn) {
            const sid = delSettlementBtn.getAttribute('data-del-settlement');
            state.settlements = state.settlements.filter(s => s.id !== sid);
            saveState();
            document.getElementById('proofLightboxModal').classList.add('hidden');
            renderAll();
            showToast('Settlement record removed.');
            return;
          }

          if (e.target.id === 'btnDoneProofModal' || e.target.id === 'btnCloseProofModal') {
            document.getElementById('proofLightboxModal').classList.add('hidden');
          }
        });

        // Custom Settle buttons
        document.getElementById('btnOpenCustomSettle').addEventListener('click', () => openSettleModal());
        document.getElementById('btnOpenSettleFromTab').addEventListener('click', () => openSettleModal());
        document.getElementById('btnCloseSettleModal').addEventListener('click', () => {
          document.getElementById('settleModal').classList.add('hidden');
        });
        document.getElementById('btnCancelSettleModal').addEventListener('click', () => {
          document.getElementById('settleModal').classList.add('hidden');
        });

        document.getElementById('settleTo').addEventListener('change', updateReceiverWalletBanner);

        document.getElementById('btnCopyReceiverWallet').addEventListener('click', () => {
          const toId = document.getElementById('settleTo').value;
          const r = getFriend(toId);
          copyTextToClipboard(r.walletNum, `Copied ${r.name}'s ${r.walletApp} number!`);
        });

        // Handle Screenshot image upload
        document.getElementById('settleScreenshotInput').addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function (evt) {
            draftUploadedScreenshotDataUrl = evt.target.result;
            const img = document.getElementById('uploadedScreenshotPreview');
            img.src = draftUploadedScreenshotDataUrl;
            document.getElementById('uploadedScreenshotPreviewWrap').classList.remove('hidden');
          };
          reader.readAsDataURL(file);
        });

        // Submit Settle Up Form
        document.getElementById('settleForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const fromId = document.getElementById('settleFrom').value;
          const toId = document.getElementById('settleTo').value;
          const amount = Number(document.getElementById('settleAmount').value) || 0;
          const method = document.getElementById('settleMethod').value;
          const note = document.getElementById('settleNote').value.trim();
          const errEl = document.getElementById('settleErrorMsg');

          if (fromId === toId) {
            errEl.textContent = 'Sender and Receiver must be two different friends.';
            errEl.classList.remove('hidden');
            return;
          }
          if (amount <= 0) {
            errEl.textContent = 'Please enter a valid payment amount greater than 0.';
            errEl.classList.remove('hidden');
            return;
          }

          const isVerbal = method.includes('Told') || method.includes('Cash');
          const newSettlement = {
            id: 's' + Date.now(),
            fromId,
            toId,
            amount,
            method,
            mode: isVerbal ? 'verbal' : 'screenshot',
            note: note || (isVerbal ? 'Told in person at hostel / uni' : `Online transfer via ${method}`),
            timestamp: 'Just now',
            verified: true,
            customImage: draftUploadedScreenshotDataUrl
          };

          state.settlements.unshift(newSettlement);
          saveState();
          document.getElementById('settleModal').classList.add('hidden');
          renderAll();
          showToast(`Recorded ${formatMoney(amount)} payment from ${getFriend(fromId).name} to ${getFriend(toId).name}!`);
        });

        // Add Hostel Friend Modal
        document.getElementById('btnOpenAddFriendModal').addEventListener('click', () => {
          document.getElementById('friendNameInput').value = '';
          document.getElementById('friendRoomInput').value = '';
          document.getElementById('friendWalletNumInput').value = '';
          document.getElementById('addFriendError').classList.add('hidden');
          document.getElementById('addFriendModal').classList.remove('hidden');
        });
        document.getElementById('btnCloseFriendModal').addEventListener('click', () => {
          document.getElementById('addFriendModal').classList.add('hidden');
        });
        document.getElementById('btnCancelFriendModal').addEventListener('click', () => {
          document.getElementById('addFriendModal').classList.add('hidden');
        });

        document.getElementById('addFriendForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('friendNameInput').value.trim();
          const room = document.getElementById('friendRoomInput').value.trim() || 'Hostel Room';
          const walletApp = document.getElementById('friendWalletAppInput').value;
          const walletNum = document.getElementById('friendWalletNumInput').value.trim() || '0300-0000000';
          const errEl = document.getElementById('addFriendError');

          if (!name) {
            errEl.textContent = "Please enter your friend's name.";
            errEl.classList.remove('hidden');
            return;
          }

          const palette = ['#0F766E', '#4338CA', '#B91C1C', '#A16207', '#1D4ED8', '#6D28D9'];
          const newFriend = {
            id: 'f' + Date.now(),
            name,
            room,
            walletApp,
            walletNum,
            color: palette[state.friends.length % palette.length]
          };

          state.friends.push(newFriend);
          saveState();
          document.getElementById('addFriendModal').classList.add('hidden');
          syncMealFormSquadControls(true);
          renderAll();
          showToast(`Added ${name} (${room}) to the hostel squad!`);
        });

        // WhatsApp Khata Summary Copy (Private to Logged-In User!)
        document.getElementById('btnWhatsAppShare').addEventListener('click', () => {
          const myId = getActiveUserId();
          const me = getFriend(myId);
          const summary = computeSquadLedger();
          const myTransfers = summary.simplifiedTransfers.filter(t => t.fromId === myId || t.toId === myId);
          const lines = [
            `*KhataBites - ${me.name}'s Personal Khata Summary*`,
            `Account: ${me.walletApp} (${me.walletNum})`,
            ``
          ];
          if (myTransfers.length === 0) {
            lines.push(`I am 100% settled up with everyone!`);
          } else {
            myTransfers.forEach(t => {
              const s = getFriend(t.fromId);
              const r = getFriend(t.toId);
              if (t.fromId === myId) {
                lines.push(`- I owe *${r.name}*: ${formatMoney(t.amount)} (${r.walletApp}: ${r.walletNum})`);
              } else {
                lines.push(`- *${s.name}* owes me: ${formatMoney(t.amount)} (Send to ${me.walletApp}: ${me.walletNum})`);
              }
            });
          }
          lines.push(``, `(Other squad members' balances are kept private)`);
          copyTextToClipboard(lines.join('\n'), `Copied ${me.name}'s private WhatsApp summary!`);
        });
      }

      // --- MULTI-GROUP & PERSONAL ACCOUNT EXTENSIONS (Clean Production Group) ---
      const MULTI_GROUPS_Presets = [
        {
          id: 'g_hostel_dinner',
          name: 'Main Uni & Hostel Squad',
          schedule: 'Daily Squad Meals',
          code: 'SQUAD-1',
          meals: [],
          settlements: []
        }
      ];

      if (!state.groups || !Array.isArray(state.groups) || state.groups.length === 0) {
        state.groups = MULTI_GROUPS_Presets;
        state.activeGroupId = 'g_hostel_dinner';
      }
      if (!state.loggedInUserId) {
        state.loggedInUserId = state.friends[0].id;
      }

      function syncActiveGroupToState() {
        const grp = state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
        if (grp) {
          state.activeGroupId = grp.id;
          state.meals = grp.meals;
          state.settlements = grp.settlements;
        }
      }

      function persistActiveGroupData() {
        const grp = state.groups.find(g => g.id === state.activeGroupId);
        if (grp) {
          grp.meals = state.meals;
          grp.settlements = state.settlements;
        }
        saveState();
      }

      function computeCrossGroupStandingForUser(userId) {
        let totalNet = 0;
        state.groups.forEach(grp => {
          (grp.meals || []).forEach(meal => {
            const math = computeMealMath(meal);
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
      }

      function renderAdminPrivilegeState() {
        const isAdmin = Boolean(state.isAdminUnlocked);
        const adminPanel = document.getElementById('adminProtectedPanel');
        const cloudPill = document.getElementById('btnCloudStatusPill');
        const passInput = document.getElementById('adminPasscodeInput');
        const unlockBtn = document.getElementById('btnUnlockAdmin');
        const lockBtn = document.getElementById('btnLockAdmin');
        const badge = document.getElementById('adminStatusBadge');

        if (adminPanel) adminPanel.classList.toggle('hidden', !isAdmin);
        if (cloudPill) {
          cloudPill.classList.toggle('hidden', !isAdmin);
          cloudPill.classList.toggle('inline-flex', isAdmin);
        }
        if (passInput) passInput.classList.toggle('hidden', isAdmin);
        if (unlockBtn) unlockBtn.classList.toggle('hidden', isAdmin);
        if (lockBtn) lockBtn.classList.toggle('hidden', !isAdmin);
        if (badge) {
          badge.textContent = isAdmin ? 'Admin Mode Unlocked' : 'Standard Student Mode';
          badge.className = isAdmin
            ? 'text-[11px] font-bold uppercase tracking-wider text-emerald-700'
            : 'text-[11px] font-bold uppercase tracking-wider text-subtle';
        }
      }

      function renderMultiGroupAndAccountBar() {
        persistActiveGroupData();
        renderAdminPrivilegeState();
        const me = getFriend(state.loggedInUserId);
        const avatarEl = document.getElementById('loggedInAvatar');
        const nameEl = document.getElementById('loggedInUserName');
        const handleEl = document.getElementById('loggedInHandleBadge');
        const crossEl = document.getElementById('loggedInCrossGroupSummary');

        if (avatarEl) {
          avatarEl.textContent = me.name.slice(0, 2).toUpperCase();
          avatarEl.style.backgroundColor = me.color || '#18181B';
        }
        if (nameEl) nameEl.textContent = `${me.name} (${me.room})`;
        if (handleEl) handleEl.textContent = `${me.walletApp} | ${me.walletNum}`;

        const allGroupsNet = computeCrossGroupStandingForUser(me.id);
        if (crossEl) {
          const netLabel = allGroupsNet > 1
            ? `<strong class="text-emerald-700 font-mono-num">+${formatMoney(allGroupsNet)} to receive</strong>`
            : allGroupsNet < -1
              ? `<strong class="text-terracotta-600 font-mono-num">${formatMoney(allGroupsNet)} you owe</strong>`
              : `<strong class="text-muted">Settled (0)</strong>`;
          crossEl.innerHTML = `Net across all ${state.groups.length} groups today: ${netLabel}`;
        }

        const activeGrp = state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
        const codeEl = document.getElementById('activeGroupCodeDisplay');
        if (codeEl && activeGrp) {
          codeEl.innerHTML = `Group Invite Code: <strong class="font-mono-num text-ink">${escapeHtml(activeGrp.code)}</strong>`;
        }

        const bar = document.getElementById('groupsSwitchBar');
        if (bar) {
          bar.innerHTML = state.groups.map(g => {
            const isAct = g.id === state.activeGroupId;
            const grpMealsCount = (g.meals || []).length;
            const grpTotal = (g.meals || []).reduce((sum, m) => sum + (Number(m.totalBill) || 0), 0);
            return `
              <button type="button" data-switch-group="${g.id}" class="text-left p-3 rounded-xl border transition flex items-center justify-between gap-2 ${isAct ? 'bg-zinc-100 border-terracotta-600 ring-1 ring-terracotta-600 shadow-2xs' : 'bg-canvas hover:bg-oat/70 border-[#E5E0D8]'}">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="font-display font-bold text-xs text-ink truncate">${escapeHtml(g.name)}</span>
                    ${isAct ? '<span class="px-1.5 py-0.2 rounded bg-terracotta-600 text-white text-[10px] font-bold">Active</span>' : ''}
                  </div>
                  <div class="text-[11px] text-muted truncate mt-0.5">${escapeHtml(g.schedule)} | Code: <span class="font-mono-num font-semibold">${escapeHtml(g.code)}</span></div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-mono-num font-bold text-xs text-ink">${formatMoney(grpTotal)}</div>
                  <div class="text-[10px] text-subtle">${grpMealsCount} meals</div>
                </div>
              </button>
            `;
          }).join('');
        }
      }

      function initMultiGroupEvents() {
        document.getElementById('groupsSwitchBar').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-switch-group]');
          if (!btn) return;
          persistActiveGroupData();
          state.activeGroupId = btn.getAttribute('data-switch-group');
          syncActiveGroupToState();
          saveState();
          renderAll();
          renderMultiGroupAndAccountBar();
          const grp = state.groups.find(g => g.id === state.activeGroupId);
          if (grp) showToast(`Switched to "${grp.name}"!`);
        });

        // Account Modal
        document.getElementById('btnOpenAccountModal').addEventListener('click', () => {
          const sel = document.getElementById('accountSwitchSelect');
          sel.innerHTML = state.friends.map(f => `<option value="${f.id}" ${f.id === state.loggedInUserId ? 'selected' : ''}>${f.name} (${f.room} | ${f.walletApp})</option>`).join('');
          document.getElementById('accountModal').classList.remove('hidden');
        });
        document.getElementById('btnCloseAccountModal').addEventListener('click', () => {
          document.getElementById('accountModal').classList.add('hidden');
        });
        document.getElementById('accountSwitchSelect').addEventListener('change', (e) => {
          state.loggedInUserId = e.target.value;
          state.perspectiveId = e.target.value;
          saveState();
          renderAll();
          renderMultiGroupAndAccountBar();
          document.getElementById('accountModal').classList.add('hidden');
          showToast(`Logged in as ${getFriend(state.loggedInUserId).name}!`);
        });
        document.getElementById('registerAccountForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('regAccountName').value.trim();
          if (!name) return;
          const room = document.getElementById('regAccountRoom').value.trim() || 'Hostel Room';
          const walletApp = document.getElementById('regAccountWalletApp').value;
          const walletNum = document.getElementById('regAccountWalletNum').value.trim() || '0300-1122334';
          const newF = {
            id: 'f' + Date.now(),
            name,
            room,
            walletApp,
            walletNum,
            color: '#0F766E'
          };
          state.friends.push(newF);
          state.loggedInUserId = newF.id;
          state.perspectiveId = newF.id;
          saveState();
          syncMealFormSquadControls(true);
          renderAll();
          renderMultiGroupAndAccountBar();
          document.getElementById('regAccountName').value = '';
          document.getElementById('accountModal').classList.add('hidden');
          showToast(`Created personal account for ${name} & signed in!`);
        });

        // Group Modal
        document.getElementById('btnOpenGroupModal').addEventListener('click', () => {
          document.getElementById('newGroupName').value = '';
          document.getElementById('newGroupSchedule').value = '';
          document.getElementById('newGroupCode').value = '';
          document.getElementById('groupModal').classList.remove('hidden');
        });
        document.getElementById('btnCloseGroupModal').addEventListener('click', () => {
          document.getElementById('groupModal').classList.add('hidden');
        });
        document.getElementById('btnCancelGroupModal').addEventListener('click', () => {
          document.getElementById('groupModal').classList.add('hidden');
        });
        document.getElementById('createGroupForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('newGroupName').value.trim();
          if (!name) return;
          const schedule = document.getElementById('newGroupSchedule').value.trim() || 'Daily Squad Meal';
          const code = (document.getElementById('newGroupCode').value.trim() || ('GRP-' + Math.floor(100 + Math.random() * 900))).toUpperCase();
          persistActiveGroupData();
          const newG = {
            id: 'g_' + Date.now(),
            name,
            schedule,
            code,
            meals: [],
            settlements: []
          };
          state.groups.push(newG);
          state.activeGroupId = newG.id;
          syncActiveGroupToState();
          saveState();
          document.getElementById('groupModal').classList.add('hidden');
          renderAll();
          renderMultiGroupAndAccountBar();
          showToast(`Created dining group "${name}" (Code: ${code})!`);
        });

        // Admin Privileges Unlock / Lock Controls
        const adminForm = document.getElementById('adminUnlockForm');
        if (adminForm) {
          adminForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const code = (document.getElementById('adminPasscodeInput').value || '').trim();
            if (code === 'admin123' || code === '1234' || code.toLowerCase() === 'admin') {
              state.isAdminUnlocked = true;
              document.getElementById('adminPasscodeInput').value = '';
              saveState();
              renderAdminPrivilegeState();
              showToast('Admin privileges unlocked. Deployment and Supabase settings are now visible.');
            } else {
              showToast('Invalid Admin Passcode. Default admin code is admin123.');
            }
          });
        }
        const btnLockAdmin = document.getElementById('btnLockAdmin');
        if (btnLockAdmin) {
          btnLockAdmin.addEventListener('click', () => {
            state.isAdminUnlocked = false;
            saveState();
            renderAdminPrivilegeState();
            showToast('Exited Admin Mode. App is now in Standard Student Mode.');
          });
        }

        // Admin Clean Reset / Wipe Dummy Data Button
        const btnResetClean = document.getElementById('btnResetCleanSlate');
        if (btnResetClean) {
          btnResetClean.addEventListener('click', () => {
            if (!state.isAdminUnlocked) return;
            state = JSON.parse(JSON.stringify(DEFAULT_STATE));
            state.groups = JSON.parse(JSON.stringify(MULTI_GROUPS_Presets));
            state.activeGroupId = state.groups[0].id;
            state.isAdminUnlocked = true;
            draftSoloItems = [];
            try {
              localStorage.removeItem('khatabites_uni_hostel_state_v1');
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) {}
            syncActiveGroupToState();
            syncMealFormSquadControls(false);
            saveState();
            renderAll();
            showToast('Wiped all dummy data! App and Supabase database are now 100% clean.');
          });
        }

        // Admin Inline Supabase Save Button
        const btnSaveInlineSb = document.getElementById('btnSaveInlineSupabase');
        if (btnSaveInlineSb) {
          btnSaveInlineSb.addEventListener('click', () => {
            const url = (document.getElementById('adminInlineSbUrl').value || '').trim();
            const key = (document.getElementById('adminInlineSbKey').value || '').trim();
            if (!url || !key) {
              showToast('Please paste both your Supabase Project URL and Anon Public Key.');
              return;
            }
            try {
              localStorage.setItem('khatabites_sb_url', url);
              localStorage.setItem('khatabites_sb_key', key);
            } catch (e) {}
            initSupabaseCloud();
            saveState();
            showToast('Connected to your Supabase PostgreSQL database!');
          });
        }

        // Copy SQL Snippet Button
        const btnCopySql = document.getElementById('btnCopySqlSnippet');
        if (btnCopySql) {
          btnCopySql.addEventListener('click', () => {
            const sql = [
              'create table if not exists public.khata_cloud_store (',
              '  room_key text primary key,',
              '  payload jsonb not null,',
              '  updated_at timestamptz default now()',
              ');',
              'alter table public.khata_cloud_store enable row level security;',
              'create policy "Allow public squad sync" on public.khata_cloud_store for all using (true) with check (true);'
            ].join('\n');
            copyTextToClipboard(sql, 'Copied Supabase SQL script! Paste and Run it in your Supabase SQL Editor.');
          });
        }

        // Deploy & Code Modal + Cloud DB Controls (Restricted to Admin)
        document.getElementById('btnOpenDeployGuide').addEventListener('click', () => {
          if (!state.isAdminUnlocked) {
            showToast('Admin privileges required to access deployment settings.');
            return;
          }
          document.getElementById('deployGuideModal').classList.remove('hidden');
        });
        document.getElementById('btnCloudStatusPill').addEventListener('click', () => {
          document.getElementById('deployGuideModal').classList.remove('hidden');
        });
        document.getElementById('btnConnectSupabaseNow').addEventListener('click', () => {
          const url = document.getElementById('supabaseUrlInput').value.trim();
          const key = document.getElementById('supabaseKeyInput').value.trim();
          if (!url || !key) {
            showToast('Please enter both your Supabase Project URL and Anon Key.');
            return;
          }
          try {
            localStorage.setItem('khatabites_sb_url', url);
            localStorage.setItem('khatabites_sb_key', key);
          } catch (e) {}
          initSupabaseCloud();
          saveState();
          showToast('Connected to Supabase Cloud Database!');
        });
        document.getElementById('btnSyncCloudNow').addEventListener('click', () => {
          pullFromSupabaseCloud(true);
        });
        document.getElementById('btnCloseDeployModal').addEventListener('click', () => {
          document.getElementById('deployGuideModal').classList.add('hidden');
        });
        document.getElementById('btnDoneDeployModal').addEventListener('click', () => {
          document.getElementById('deployGuideModal').classList.add('hidden');
        });
        document.getElementById('btnDownloadSourceHtml').addEventListener('click', () => {
          const blob = new Blob([document.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'index.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('Downloaded index.html - ready to upload to GitHub & Vercel!');
        });
      }


      // --- 5-PAGE NAVIGATION ROUTER ---
      if (!state.activePage) {
        state.activePage = 'dashboard';
      }

      function switchToPage(pageName) {
        state.activePage = pageName;
        const pages = {
          dashboard: document.getElementById('pageViewDashboard'),
          split: document.getElementById('pageViewSplit'),
          history: document.getElementById('pageViewHistory'),
          groups: document.getElementById('pageViewGroups'),
          setup: document.getElementById('pageViewSetup')
        };
        Object.keys(pages).forEach(k => {
          if (pages[k]) pages[k].classList.toggle('hidden', k !== pageName);
        });

        // Update top nav buttons
        document.querySelectorAll('.page-nav-btn').forEach(btn => {
          const isAct = btn.getAttribute('data-nav-page') === pageName;
          btn.className = isAct
            ? 'page-nav-btn py-2.5 px-2 rounded-xl text-xs font-bold transition bg-terracotta-600 text-white shadow-sm text-center truncate'
            : 'page-nav-btn py-2.5 px-2 rounded-xl text-xs font-bold transition text-muted hover:text-ink hover:bg-white/60 text-center truncate';
        });

        // Update mobile bottom nav buttons
        document.querySelectorAll('.page-nav-mobile').forEach(btn => {
          const isAct = btn.getAttribute('data-nav-page') === pageName;
          btn.className = isAct
            ? 'page-nav-mobile py-1 text-[10px] font-bold text-terracotta-600'
            : 'page-nav-mobile py-1 text-[10px] font-semibold text-muted';
        });

        // Update header subtitle context
        const activeGrp = (state.groups || []).find(g => g.id === state.activeGroupId);
        const me = getFriend(state.loggedInUserId);
        const sub = document.getElementById('headerContextSubtitle');
        if (sub && activeGrp) {
          sub.textContent = `${activeGrp.name} (${activeGrp.code}) | Logged in as ${me.name}`;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      function initPageRouterEvents() {
        document.addEventListener('click', (e) => {
          const navBtn = e.target.closest('[data-nav-page]');
          if (navBtn) {
            switchToPage(navBtn.getAttribute('data-nav-page'));
            return;
          }
          const gotoBtn = e.target.closest('[data-goto-page]');
          if (gotoBtn) {
            const p = gotoBtn.getAttribute('data-goto-page');
            if (p === 'history') state.activeTab = 'meals';
            renderAll();
            switchToPage(p);
          }
        });
      }

      // Initialize Application
      syncActiveGroupToState();
      syncMealFormSquadControls(false);
      renderAll();
      renderMultiGroupAndAccountBar();
      initEvents();
      initMultiGroupEvents();
      initPageRouterEvents();
      switchToPage(state.activePage || 'dashboard');
      initSupabaseCloud();
    })();
