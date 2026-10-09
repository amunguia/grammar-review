// Japanese Grammar Reviewer - Plain JS State & Extension Controller

document.addEventListener('DOMContentLoaded', () => {

  // State Variables
  let selectedLevel = 'n3';
  let selectedMode = 'sequential';
  
  let deckData = [];
  let orderIndices = [];
  let reviewedSet = new Set(); // Set of integer indices completed for this level
  let initialReviewedCount = 0; // Number of cards already reviewed in previous sessions
  let currentIndex = 0;
  let revealStep = 0; // 0: Title, 1: Translation, 2: Formation, 3: Examples

  // Extension Integration State
  let requestCounter = 0;
  const pendingRequests = new Map();
  let extensionConnected = false;

  // DOM Elements
  const selectionScreen = document.getElementById('selection-screen');
  const reviewScreen = document.getElementById('review-screen');
  
  const levelOptions = document.getElementById('level-options');
  const modeOptions = document.getElementById('mode-options');
  const btnStartReview = document.getElementById('btn-start-review');
  
  const extStatusBadge = document.getElementById('extension-status-badge');
  const activeLevelBadge = document.getElementById('active-level-badge');
  const btnChangeLevel = document.getElementById('btn-change-level');
  const btnResetProgress = document.getElementById('btn-reset-progress');
  
  const progressFill = document.getElementById('progress-fill');
  const cardCounter = document.getElementById('card-counter');
  const lessonInfo = document.getElementById('lesson-info');
  
  // Card Sections
  const sectionGrammar = document.getElementById('section-grammar');
  const sectionTranslation = document.getElementById('section-translation');
  const sectionFormation = document.getElementById('section-formation');
  const sectionExamples = document.getElementById('section-examples');
  
  const cardGrammarPoint = document.getElementById('card-grammar-point');
  const cardTranslation = document.getElementById('card-translation');
  const cardFormation = document.getElementById('card-formation');
  const cardExplanation = document.getElementById('card-explanation');
  const cardExamplesList = document.getElementById('card-examples-list');
  
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const stepDots = document.getElementById('step-dots').children;

  // --- Chrome Extension Bridge (window.postMessage) ---

  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.target === 'JAPANESE_GRAMMAR_REVIEWER_READY') {
      extensionConnected = true;
      console.log(`🔌 [Extension Bridge] Chrome Extension Content Script Ready (v${event.data.version || '1.0'})`);
      updateExtensionStatus(true, `Ext Active (v${event.data.version || '1.0'})`);
    }

    if (event.data.target === 'JAPANESE_GRAMMAR_REVIEWER_RES') {
      const { requestId, response } = event.data;
      if (pendingRequests.has(requestId)) {
        const resolve = pendingRequests.get(requestId);
        pendingRequests.delete(requestId);
        resolve(response);
      }
    }
  });

  async function callExtension(action, key, indices = []) {
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${++requestCounter}`;
      pendingRequests.set(requestId, resolve);

      // Normalize indices to integers before sending
      const normalizedIndices = (indices || []).map(x => parseInt(x, 10)).filter(x => !isNaN(x));

      console.log(`📤 [Extension Outbound] Action: "${action}" | Key: "${key}" | Indices: [${normalizedIndices.join(', ')}]`);

      // Timeout fallback if extension is not installed
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          console.warn(`⏳ [Extension Timeout] No response received for ${action} "${key}". Falling back to local mode.`);
          resolve({ status: 'error', error: 'Extension timeout' });
        }
      }, 2000);

      window.postMessage({
        target: 'JAPANESE_GRAMMAR_REVIEWER_REQ',
        requestId: requestId,
        action: action,
        key: key,
        indices: normalizedIndices
      }, '*');
    });
  }

  function updateExtensionStatus(connected, text) {
    extensionConnected = connected;
    if (connected) {
      extStatusBadge.className = 'ext-status-badge connected';
      extStatusBadge.querySelector('.status-text').textContent = text || 'Extension Connected';
    } else {
      extStatusBadge.className = 'ext-status-badge offline';
      extStatusBadge.querySelector('.status-text').textContent = 'Local Mode';
    }
  }

  // --- Event Listeners: Level & Mode Selection ---

  levelOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.level-btn');
    if (!btn) return;
    levelOptions.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLevel = btn.getAttribute('data-level');
  });

  modeOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    modeOptions.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.getAttribute('data-mode');
  });

  btnStartReview.addEventListener('click', startReview);

  btnChangeLevel.addEventListener('click', () => {
    reviewScreen.classList.remove('active');
    selectionScreen.classList.add('active');
    activeLevelBadge.classList.add('hidden');
    btnChangeLevel.classList.add('hidden');
    btnResetProgress.classList.add('hidden');
  });

  btnResetProgress.addEventListener('click', async () => {
    const levelKey = selectedLevel.toUpperCase();
    if (confirm(`Reset stored review progress for ${levelKey}?`)) {
      console.log(`🗑️ [Extension Action] User triggered manual reset for level "${levelKey}"`);
      await callExtension('Clear', levelKey);
      reviewedSet.clear();
      initialReviewedCount = 0;
      alert(`Cleared storage progress for ${levelKey}. Restarting session.`);
      startReview();
    }
  });

  // --- Controls: Step Advancement & Navigation ---

  btnNext.addEventListener('click', handleNext);
  btnPrev.addEventListener('click', handlePrev);

  // Global Keyboard Navigation
  document.addEventListener('keydown', (e) => {
    if (!reviewScreen.classList.contains('active')) return;

    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      handleNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      e.preventDefault();
      handlePrev();
    }
  });

  // --- Core Review Flow ---

  async function startReview() {
    btnStartReview.disabled = true;
    btnStartReview.textContent = 'Loading Deck...';

    const filename = `bunpro_${selectedLevel}_grammar.json`;
    const levelKey = selectedLevel.toUpperCase();

    try {
      const response = await fetch(filename);
      if (!response.ok) {
        throw new Error(`Failed to load ${filename}`);
      }
      deckData = await response.json();

      // Full list of candidate indices (0 to N-1)
      let candidateIndices = Array.from({ length: deckData.length }, (_, i) => i);
      if (selectedMode === 'random') {
        shuffleArray(candidateIndices);
      }

      // Extension Lookup: Query previously reviewed indices for this level
      const lookupRes = await callExtension('Lookup', levelKey);
      let rawReviewedList = [];

      if (lookupRes && (lookupRes.status === 'success' || Array.isArray(lookupRes.data) || Array.isArray(lookupRes.result))) {
        rawReviewedList = lookupRes.data || lookupRes.result || [];
        updateExtensionStatus(true, `Ext Synced (${levelKey})`);
      } else {
        updateExtensionStatus(false, 'Local Mode');
      }

      // Convert all returned indices to Numbers to guarantee strict type matching!
      const parsedReviewedIndices = rawReviewedList.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
      reviewedSet = new Set(parsedReviewedIndices);
      initialReviewedCount = reviewedSet.size;

      // Integration Point Logging: Log Lookup results & index filtering breakdown
      console.group(`🔍 [Extension Integration] Lookup & Filter for Level "${levelKey}" (Mode: ${selectedMode})`);
      console.log(`1. Raw Lookup Response:`, lookupRes);
      console.log(`2. Returned Reviewed Indices Array (${parsedReviewedIndices.length}):`, parsedReviewedIndices);
      console.log(`3. Total Candidate Cards in Deck: ${candidateIndices.length}`);

      // Perform Filtering
      const removedIndices = [];
      const remainingIndices = [];

      candidateIndices.forEach(idx => {
        if (reviewedSet.has(idx)) {
          removedIndices.push(idx);
        } else {
          remainingIndices.push(idx);
        }
      });

      console.log(`4. Items Removed from Current Cycle (${removedIndices.length}):`, removedIndices);
      console.log(`5. Remaining Indices for Current Cycle (${remainingIndices.length}):`, remainingIndices);

      if (removedIndices.length > 0) {
        if (remainingIndices.length === 0) {
          console.warn(`⚠️ All ${candidateIndices.length} cards in level "${levelKey}" were previously reviewed! Resetting storage for new round.`);
          await callExtension('Clear', levelKey);
          reviewedSet.clear();
          initialReviewedCount = 0;
          orderIndices = candidateIndices;
        } else {
          orderIndices = remainingIndices;
        }
      } else {
        orderIndices = candidateIndices;
      }
      console.groupEnd();

      currentIndex = 0;
      revealStep = 0;

      // Update Header Badges
      activeLevelBadge.textContent = levelKey;
      activeLevelBadge.classList.remove('hidden');
      btnChangeLevel.classList.remove('hidden');
      btnResetProgress.classList.remove('hidden');

      // Switch Screens
      selectionScreen.classList.remove('active');
      reviewScreen.classList.add('active');

      renderCard();

    } catch (err) {
      alert(`Could not load dataset for ${levelKey}. Make sure server is running.`);
      console.error(err);
    } finally {
      btnStartReview.disabled = false;
      btnStartReview.textContent = 'Start Reviewing';
    }
  }

  async function handleNext() {
    if (deckData.length === 0 || orderIndices.length === 0) return;
    const levelKey = selectedLevel.toUpperCase();

    if (revealStep < 3) {
      revealStep += 1;
      updateStepVisibility(true);
    } else {
      // Step 3 (all details revealed) -> Record reviewed card and advance
      const justReviewedIndex = orderIndices[currentIndex];

      // Add to local reviewedSet and append to Extension storage
      reviewedSet.add(justReviewedIndex);
      console.log(`✅ [Card Completed] Index ${justReviewedIndex} ("${deckData[justReviewedIndex]?.grammar_point}") finished -> Appending to "${levelKey}" storage.`);
      callExtension('Append', levelKey, [justReviewedIndex]);

      // Check if end of remaining array is reached
      if (currentIndex < orderIndices.length - 1) {
        currentIndex += 1;
        revealStep = 0;
        renderCard();
      } else {
        // End of array reached -> Clear stored indices to reset
        console.log(`🏁 [Cycle Complete] All cards in "${levelKey}" finished! Clearing extension storage.`);
        await callExtension('Clear', levelKey);
        reviewedSet.clear();
        initialReviewedCount = 0;
        
        if (confirm(`🎉 You completed all cards in this ${levelKey} cycle! Progress has been reset. Start a new cycle?`)) {
          startReview();
        }
      }
    }
  }

  function handlePrev() {
    if (deckData.length === 0 || orderIndices.length === 0) return;

    if (currentIndex > 0) {
      currentIndex -= 1;
      revealStep = 0;
      renderCard();
    } else if (revealStep > 0) {
      revealStep = 0;
      updateStepVisibility(false);
    }
  }

  function renderCard() {
    if (orderIndices.length === 0) return;

    const itemIndex = orderIndices[currentIndex];
    const item = deckData[itemIndex];

    const totalDeckSize = deckData.length;
    const remainingCount = orderIndices.length;

    // Calculate total completed cards count across the level deck
    const overallCompleted = initialReviewedCount + currentIndex;

    // Format Card Counter
    if (initialReviewedCount > 0) {
      cardCounter.textContent = `Card ${currentIndex + 1} / ${remainingCount} (${initialReviewedCount} reviewed in prev session)`;
    } else {
      cardCounter.textContent = `Card ${currentIndex + 1} / ${remainingCount}`;
    }
    
    // Overall Progress Bar Fill (percentage across total deck size)
    const percentage = Math.min(100, Math.max(0, (overallCompleted / totalDeckSize) * 100));
    progressFill.style.width = `${percentage}%`;

    const lessonText = item.lesson ? `${item.lesson}${item.lesson_topic ? ': ' + item.lesson_topic : ''}` : '';
    lessonInfo.textContent = lessonText;

    // Populate Grammar Point
    cardGrammarPoint.textContent = item.grammar_point || '—';

    // Populate Translation
    cardTranslation.textContent = item.general_translation || '—';

    // Populate Formation
    cardFormation.textContent = item.formation || item.casual_structure || item.polite_structure || 'No formation notes available.';

    // Populate Explanation & Examples
    cardExplanation.textContent = item.explanation || '';
    
    // Related Badge Indicator Click Listener (jumps to Step 4)
    const relatedBadgeIndicator = document.getElementById('related-badge-indicator');
    if (relatedBadgeIndicator) {
      relatedBadgeIndicator.addEventListener('click', () => {
        if (revealStep < 3) {
          revealStep = 3;
          updateStepVisibility(true);
          const cardRelatedContainer = document.getElementById('card-related-container');
          if (cardRelatedContainer) {
            cardRelatedContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    }

    // Populate Related & Similar Grammar Points
    const cardRelatedContainer = document.getElementById('card-related-container');
    const cardRelatedList = document.getElementById('card-related-list');

    if (cardRelatedContainer && cardRelatedList) {
      cardRelatedList.innerHTML = '';
      const relatedGps = item.related_grammar || item.related_grammar_points || [];

      if (relatedBadgeIndicator) {
        if (relatedGps.length > 0) {
          relatedBadgeIndicator.textContent = `🔄 ${relatedGps.length} Related Note${relatedGps.length > 1 ? 's' : ''} (Step 4)`;
          relatedBadgeIndicator.classList.remove('hidden');
        } else {
          relatedBadgeIndicator.classList.add('hidden');
        }
      }

      if (relatedGps.length === 0) {
        cardRelatedContainer.style.display = 'none';
      } else {
        cardRelatedContainer.style.display = 'flex';
        relatedGps.forEach(rel => {
          const div = document.createElement('div');
          div.className = 'related-item';

          const levelStr = rel.level ? rel.level.replace('JLPT', 'N') : '';
          const badgeHtml = levelStr ? `<span class="related-level-badge">${escapeHTML(levelStr)}</span>` : '';
          const transHtml = rel.general_translation ? `<div class="related-translation">Meaning: ${escapeHTML(rel.general_translation)}</div>` : '';
          const noteHtml = rel.difference_note ? `<div class="related-note-box">💡 <strong>Nuance Difference:</strong> ${escapeHTML(rel.difference_note)}</div>` : '';

          div.innerHTML = `
            <div class="related-item-header">
              <span class="related-gp-title">${escapeHTML(rel.grammar_point)}</span>
              ${badgeHtml}
            </div>
            ${transHtml}
            ${noteHtml}
          `;
          cardRelatedList.appendChild(div);
        });
      }
    }

    cardExamplesList.innerHTML = '';
    const examples = item.example_sentences || [];
    if (examples.length === 0) {
      cardExamplesList.innerHTML = '<div class="example-item"><p class="example-en">No example sentences recorded for this item.</p></div>';
    } else {
      examples.forEach(ex => {
        const div = document.createElement('div');
        div.className = 'example-item';
        div.innerHTML = `
          <p class="example-jp">${escapeHTML(ex.japanese)}</p>
          <p class="example-en">${escapeHTML(ex.english)}</p>
        `;
        cardExamplesList.appendChild(div);
      });
    }

    // Enable/Disable Prev Button
    btnPrev.disabled = (currentIndex === 0 && revealStep === 0);

    // Apply Step Visibility
    updateStepVisibility(false);
  }

  function updateStepVisibility(animateNew = false) {
    // Step 0: Grammar Point (Always visible)
    sectionGrammar.classList.remove('step-hidden');

    // Step 1: Translation
    toggleSection(sectionTranslation, revealStep >= 1, animateNew && revealStep === 1);

    // Step 2: Formation
    toggleSection(sectionFormation, revealStep >= 2, animateNew && revealStep === 2);

    // Step 3: Examples & Explanation
    toggleSection(sectionExamples, revealStep >= 3, animateNew && revealStep === 3);

    // Update Dots
    for (let i = 0; i < stepDots.length; i++) {
      if (i < revealStep) {
        stepDots[i].className = 'dot completed';
      } else if (i === revealStep) {
        stepDots[i].className = 'dot active';
      } else {
        stepDots[i].className = 'dot';
      }
    }

    // Button Text Feedback
    if (revealStep === 3) {
      btnNext.innerHTML = `<span>Next Card →</span> <kbd class="kbd-badge">Enter ↵</kbd>`;
    } else {
      btnNext.innerHTML = `<span>Next Detail</span> <kbd class="kbd-badge">Enter ↵</kbd>`;
    }
  }

  function toggleSection(element, show, animate) {
    if (show) {
      element.classList.remove('step-hidden');
      if (animate) {
        element.classList.remove('animate-step');
        void element.offsetWidth; // trigger reflow for animation restart
        element.classList.add('animate-step');
      }
    } else {
      element.classList.add('step-hidden');
      element.classList.remove('animate-step');
    }
  }

  // --- Utility Helpers ---

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Probe extension readiness
  setTimeout(() => {
    if (!extensionConnected) {
      updateExtensionStatus(false, 'Local Mode');
    }
  }, 1000);

});
