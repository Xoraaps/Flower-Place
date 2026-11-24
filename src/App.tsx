import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { MeadowScene } from './engine/MeadowScene';
import { SowEventSummary, TIME_PRESETS, TimeOfDay } from './types/meadow';

interface DissolvingEcho {
  id: number;
  text: string;
}

export function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MeadowScene | null>(null);

  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('afternoon');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [dissolvingEcho, setDissolvingEcho] = useState<DissolvingEcho | null>(null);
  const [sowStatus, setSowStatus] = useState<SowEventSummary | null>(null);
  const [statusVisible, setStatusVisible] = useState(false);

  // Animated 1px underline geometry for the top-right Time Switcher
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<TimeOfDay, HTMLButtonElement | null>>({
    morning: null,
    noon: null,
    afternoon: null,
    night: null,
  });
  const [underlineStyle, setUnderlineStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const pauseTimerRef = useRef<number | null>(null);
  const statusFadeTimerRef = useRef<number | null>(null);
  const echoCounterRef = useRef(0);

  // Mount WebGL Meadow Scene
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const meadow = new MeadowScene(host, {
      onSowPhrase: (summary) => {
        setSowStatus(summary);
        setStatusVisible(true);
        if (statusFadeTimerRef.current !== null) {
          window.clearTimeout(statusFadeTimerRef.current);
        }
        statusFadeTimerRef.current = window.setTimeout(() => {
          setStatusVisible(false);
        }, 5200);
      },
    });
    sceneRef.current = meadow;

    return () => {
      if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current);
      if (statusFadeTimerRef.current !== null) window.clearTimeout(statusFadeTimerRef.current);
      meadow.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Measure active Time Switcher tab for animated 1px hairline indicator
  const updateUnderlinePosition = useCallback(() => {
    const container = navContainerRef.current;
    const activeBtn = tabRefs.current[timeOfDay];
    if (!container || !activeBtn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setUnderlineStyle({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [timeOfDay]);

  useLayoutEffect(() => {
    updateUnderlinePosition();
    const onResize = () => updateUnderlinePosition();
    window.addEventListener('resize', onResize);
    // Re-measure once web fonts finish loading
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => updateUnderlinePosition());
    }
    return () => window.removeEventListener('resize', onResize);
  }, [updateUnderlinePosition]);

  // Trigger organic bloom + smooth editorial text fade
  const commitPhraseToField = useCallback((rawText: string) => {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    const trimmed = rawText.trim();
    if (!trimmed || !sceneRef.current) return;

    sceneRef.current.bloomText(trimmed);

    echoCounterRef.current += 1;
    const echoId = echoCounterRef.current;
    setDissolvingEcho({ id: echoId, text: rawText });
    setInputValue('');

    window.setTimeout(() => {
      setDissolvingEcho((prev) => (prev?.id === echoId ? null : prev));
    }, 900);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    setInputValue(nextVal);

    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    // Automatically sow into the meadow when the user pauses typing (~1.2s)
    if (nextVal.trim().length > 0) {
      pauseTimerRef.current = window.setTimeout(() => {
        commitPhraseToField(nextVal);
      }, 1200);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    commitPhraseToField(inputValue);
  };

  const handleSelectTime = (next: TimeOfDay) => {
    setTimeOfDay(next);
    sceneRef.current?.setTimeOfDay(next);
  };

  const handleClear = () => {
    const cleared = sceneRef.current?.clearBlooms() ?? 0;
    if (cleared > 0) {
      setStatusVisible(false);
    }
  };

  const handleResetView = () => {
    sceneRef.current?.resetCameraView();
  };

  const handleToggleSound = () => {
    if (!sceneRef.current) return;
    const next = sceneRef.current.audio.toggle();
    setSoundEnabled(next);
  };

  // Adaptive Contrast:
  // - Top chrome sits over the sky dome: deep warm ink (#1C1B18) on bright daylight skies,
  //   transitioning smoothly to warm archival bone (#F2EFE9) against the obsidian night sky.
  // - Bottom editorial input sits directly over the shadowed olive grass canopy: warm archival bone
  //   (#F2EFE9) with subtle optical legibility shadow, keeping foreground foliage rich and unblocked.
  const isNight = timeOfDay === 'night';
  const inkColor = isNight ? '#F2EFE9' : '#1C1B18';
  const mutedInkColor = isNight ? 'rgba(242, 239, 233, 0.58)' : 'rgba(28, 27, 24, 0.58)';
  const subtleSeparatorColor = isNight ? 'rgba(242, 239, 233, 0.30)' : 'rgba(28, 27, 24, 0.30)';

  const bottomBoneColor = '#F2EFE9';
  const bottomMutedBoneColor = 'rgba(242, 239, 233, 0.72)';
  const bottomHairlineColor = 'rgba(242, 239, 233, 0.48)';

  return (
    <main className="relative h-screen w-screen overflow-hidden select-none">
      {/* Unobstructed Full-Viewport WebGL Wildflower Meadow */}
      <div
        ref={canvasHostRef}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        aria-label="Interactive 3D wildflower meadow canvas"
      />

      {/* Whisper-soft lower vignette anchor (no card, no pale wash) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
        style={{
          background:
            'linear-gradient(to top, rgba(14, 16, 10, 0.42) 0%, rgba(14, 16, 10, 0.14) 55%, rgba(14, 16, 10, 0) 100%)',
        }}
      />

      {/* TOP CHROME: Anchored cleanly to edges with generous 28px-40px breathing room */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col justify-between gap-4 px-7 pt-7 sm:flex-row sm:items-start sm:px-10 sm:pt-9"
        style={{
          color: inkColor,
          transition: 'color 1100ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* TOP-LEFT: Quiet Field Stamp, Editorial Title & Bare Text Actions */}
        <div className="pointer-events-auto flex flex-col gap-1.5" data-ui-control="true">
          <div className="flex items-baseline gap-3">
            <span
              className="text-[11px] font-medium uppercase tracking-[0.16em]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              FIELD 01
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.14em]"
              style={{
                fontFamily: 'var(--font-mono)',
                color: mutedInkColor,
                transition: 'color 1100ms ease',
              }}
            >
              43°19&prime;N 11°19&prime;E
            </span>
          </div>

          <h1
            className="text-[21px] font-normal italic leading-none tracking-[0.01em] sm:text-[23px]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Herbarium Vivum
          </h1>

          {/* Bare Typographic Actions */}
          <div
            className="mt-1.5 flex items-center gap-2.5 text-[11px] uppercase tracking-[0.14em]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            <button
              type="button"
              onClick={handleClear}
              className="cursor-pointer bg-transparent p-0 uppercase tracking-[0.14em] opacity-75 transition-opacity duration-300 hover:opacity-100 focus:opacity-100 focus:outline-none"
              style={{ color: inkColor }}
            >
              CLEAR
            </button>
            <span style={{ color: subtleSeparatorColor }} aria-hidden="true">
              &middot;
            </span>
            <button
              type="button"
              onClick={handleResetView}
              className="cursor-pointer bg-transparent p-0 uppercase tracking-[0.14em] opacity-75 transition-opacity duration-300 hover:opacity-100 focus:opacity-100 focus:outline-none"
              style={{ color: inkColor }}
            >
              RESET VIEW
            </button>
            <span style={{ color: subtleSeparatorColor }} aria-hidden="true">
              &middot;
            </span>
            <button
              type="button"
              onClick={handleToggleSound}
              className="cursor-pointer bg-transparent p-0 uppercase tracking-[0.14em] opacity-75 transition-opacity duration-300 hover:opacity-100 focus:opacity-100 focus:outline-none"
              style={{ color: inkColor }}
            >
              {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
            </button>
          </div>

          {/* Quiet Ephemeral Botanical Specimen Note on Sow */}
          <div
            aria-live="polite"
            className="mt-1 h-4 text-[10.5px] uppercase tracking-[0.14em] transition-opacity duration-700"
            style={{
              fontFamily: 'var(--font-mono)',
              color: mutedInkColor,
              opacity: statusVisible && sowStatus ? 1 : 0,
            }}
          >
            {sowStatus
              ? `${sowStatus.driftName} · ${sowStatus.stemCount} STEMS`
              : ''}
          </div>
        </div>

        {/* TOP-RIGHT: Minimalist Inline Time-of-Day Switcher with Animated 1px Underline */}
        <nav
          ref={navContainerRef}
          aria-label="Time of day atmosphere"
          data-ui-control="true"
          className="pointer-events-auto relative flex flex-wrap items-center gap-y-1 pb-1.5 text-[11px] uppercase tracking-[0.13em]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {TIME_PRESETS.map((preset, index) => {
            const isActive = timeOfDay === preset.id;
            return (
              <React.Fragment key={preset.id}>
                {index > 0 && (
                  <span
                    className="mx-2.5 select-none"
                    style={{
                      color: subtleSeparatorColor,
                      transition: 'color 1100ms ease',
                    }}
                    aria-hidden="true"
                  >
                    /
                  </span>
                )}
                <button
                  ref={(el) => {
                    tabRefs.current[preset.id] = el;
                  }}
                  type="button"
                  onClick={() => handleSelectTime(preset.id)}
                  aria-pressed={isActive}
                  className="cursor-pointer bg-transparent p-0 uppercase tracking-[0.13em] transition-opacity duration-400 focus:outline-none"
                  style={{
                    color: inkColor,
                    opacity: isActive ? 1 : 0.56,
                  }}
                >
                  <span className="hidden md:inline">{preset.clock} </span>
                  {preset.label}
                </button>
              </React.Fragment>
            );
          })}

          {/* Gliding 1px Active Indicator */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-[1px] transition-all duration-500 ease-out"
            style={{
              left: `${underlineStyle.left}px`,
              width: `${underlineStyle.width}px`,
              backgroundColor: inkColor,
            }}
          />
        </nav>
      </header>

      {/* BOTTOM-CENTER: Bare Borderless Editorial Input Line with 1px Hairline Rule */}
      <footer
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-7 pb-7 sm:px-10 sm:pb-9"
        style={{
          color: bottomBoneColor,
        }}
      >
        <form
          onSubmit={handleFormSubmit}
          data-ui-control="true"
          className="pointer-events-auto relative w-full max-w-[440px]"
        >
          <div className="relative flex items-center justify-center">
            {/* Subtle editorial blinking vertical bar when idle & empty */}
            {!isInputFocused && inputValue.length === 0 && !dissolvingEcho && (
              <span
                aria-hidden="true"
                className="editorial-caret-pulse pointer-events-none mr-1.5 inline-block h-[22px] w-[1px]"
                style={{ backgroundColor: bottomBoneColor }}
              />
            )}

            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type a word into the field"
              placeholder="Type a word into the field..."
              className="meadow-editorial-input w-full py-1.5 text-center text-[25px] font-normal leading-tight tracking-[0.015em] sm:text-[28px]"
              style={{
                color: bottomBoneColor,
                caretColor: bottomBoneColor,
                textShadow: '0 1px 14px rgba(10, 12, 7, 0.55)',
              }}
            />

            {/* Smoothly Dissolving Ghost Text as Flowers Rise */}
            {dissolvingEcho && (
              <span
                key={dissolvingEcho.id}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[25px] italic tracking-[0.015em] sm:text-[28px]"
                style={{
                  fontFamily: 'var(--font-serif)',
                  color: bottomBoneColor,
                  textShadow: '0 1px 14px rgba(10, 12, 7, 0.55)',
                  animation: 'echoDissolve 880ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                }}
              >
                {dissolvingEcho.text}
              </span>
            )}
          </div>

          {/* Bare 1px Bottom Hairline Rule */}
          <div
            className="h-[1px] w-full transition-colors duration-500"
            style={{
              backgroundColor: isInputFocused ? bottomBoneColor : bottomHairlineColor,
            }}
          />

          {/* Restrained Archival Micro-Note */}
          <div
            className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.15em]"
            style={{
              fontFamily: 'var(--font-mono)',
              color: bottomMutedBoneColor,
              textShadow: '0 1px 10px rgba(10, 12, 7, 0.52)',
            }}
          >
            <span>RETURN OR PAUSE TO SOW</span>
            <span>CLICK FIELD TO PLANT</span>
          </div>
        </form>
      </footer>

      <style>{`
        @keyframes echoDissolve {
          0% {
            opacity: 0.92;
            transform: translateY(0px);
            filter: blur(0px);
          }
          100% {
            opacity: 0;
            transform: translateY(-10px);
            filter: blur(4px);
          }
        }
      `}</style>
    </main>
  );
}

export default App;
