import { DAYS_PER_SEASON, OBJECTIVE_TARGETS, POPULATION_CAP, REAL_SECONDS_PER_GAME_DAY, VICTORY } from '../../sim';
import { Icon, type IconName } from '../components/Icon';
import { PANEL_HOTKEYS } from '../lib/hotkeys';

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <section className="howto__section">
      <h3 className="howto__title">
        <Icon name={icon} size={18} /> {title}
      </h3>
      {children}
    </section>
  );
}

const key = (k: string) => <span className="kbd">{k}</span>;
const panelKey = (panel: string) => Object.entries(PANEL_HOTKEYS).find(([, id]) => id === panel)?.[0].toUpperCase() ?? '';

/** The How to Play guide: controls, the core loop, survival tips and the win and lose conditions. */
export function HowToPlay() {
  const dayMinutes = REAL_SECONDS_PER_GAME_DAY / 60;
  return (
    <div className="howto" data-testid="howto">
      <p className="howto__lead">
        You are the founder of a frontier settlement. Your settlers decide what to do themselves: they gather, haul, build, eat and sleep. You decide <strong>what gets built</strong> and <strong>what matters most</strong>.
      </p>

      <Section icon="compass" title="Controls">
        <dl className="shortcut-list">
          <div className="shortcut">
            <dt>{key('Left-click')}</dt>
            <dd>Select a settler, building or tile. When placing, build here.</dd>
          </div>
          <div className="shortcut">
            <dt>{key('Right-click')}</dt>
            <dd>Cancel placement or clear the selection.</dd>
          </div>
          <div className="shortcut">
            <dt>{key('Drag')}</dt>
            <dd>Pan the map. Scroll to zoom. Click the minimap to jump.</dd>
          </div>
          <div className="shortcut">
            <dt>{key('Space')}</dt>
            <dd>Pause or resume. {key('1')} {key('2')} {key('3')} set the speed to 1x, 2x, 4x.</dd>
          </div>
          <div className="shortcut">
            <dt>
              {key(panelKey('build'))} {key(panelKey('settlers'))} {key(panelKey('priorities'))}
            </dt>
            <dd>Open Build, Settlers and Priorities. {key(panelKey('events'))} opens the log, {key(panelKey('stats'))} the charts.</dd>
          </div>
          <div className="shortcut">
            <dt>{key('Esc')}</dt>
            <dd>Cancel placement, close a panel, then open the game menu.</dd>
          </div>
        </dl>
      </Section>

      <Section icon="flag" title="The core loop">
        <ol className="howto__list">
          <li>Place a <strong>farm</strong> on grass, a <strong>well</strong> and a <strong>house</strong> near the town center. Settlers haul the materials and build.</li>
          <li>Add a <strong>lumber camp</strong> by a forest and a <strong>mine</strong> by hills, so wood and stone keep coming.</li>
          <li>Watch the top bar: every resource shows its stock, its capacity and its change per day.</li>
          <li>Use <strong>Priorities</strong> to push workers toward what you need. 0 means never, 3 means first.</li>
          <li>Complete <strong>objectives</strong> to unlock storage and the workshop, and to work toward victory.</li>
        </ol>
      </Section>

      <Section icon="heart" title="Survival tips">
        <ul className="howto__list">
          <li>Each settler eats and drinks every day. When food or water runs low, a warning appears at the top. Click it to jump to the fix.</li>
          <li>Every settler needs a bed. Settlers who sleep outdoors are unhappy, and cold in winter.</li>
          <li>A season lasts {DAYS_PER_SEASON} days (about {Math.round((DAYS_PER_SEASON * dayMinutes))} minutes at 1x). <strong>Fields lie fallow in winter</strong>, so stockpile food in autumn.</li>
          <li>Tools make work faster. A workshop crafts them from wood and stone.</li>
          <li>Open a settler to see their needs and moods. Unhappy settlers work slower and may leave.</li>
          <li>Newcomers only arrive when there are free beds and food in the larder. Traders, wanderers and festivals ask for your decision.</li>
        </ul>
      </Section>

      <Section icon="trophy" title="Winning and losing">
        <p>
          <strong>You win</strong> by reaching <strong>{VICTORY.population} settlers</strong> with an average happiness of at least <strong>{VICTORY.minAvgHappiness}</strong>. You can then keep playing as a sandbox. The colony holds up to {POPULATION_CAP} settlers, and surviving until day {OBJECTIVE_TARGETS.winterDay} counts as a milestone of its own.
        </p>
        <p>
          <strong>You lose</strong> when no settlers are left, whether they died or walked away. That is the only way to lose: a hungry colony can still recover.
        </p>
      </Section>
    </div>
  );
}
