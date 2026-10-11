import { Icon, type IconName } from '../components/Icon';

export interface PlaceholderPanelProps {
  icon: IconName;
  heading: string;
  blurb: string;
  comingIn: string;
}

/** Stand-in body for panels that are built in a later milestone. */
export function PlaceholderPanel({ icon, heading, blurb, comingIn }: PlaceholderPanelProps) {
  return (
    <div className="placeholder" data-testid="placeholder-panel">
      <div className="placeholder__art">
        <Icon name={icon} size={44} />
      </div>
      <h3 className="placeholder__heading">{heading}</h3>
      <p className="placeholder__blurb">{blurb}</p>
      <span className="placeholder__badge">Coming in {comingIn}</span>
    </div>
  );
}
