/**
 * ProfileAvatar — Single component for all profile avatar rendering.
 *
 * Priority: avatarImage (custom photo) > gradient with initials
 */

import { avatarGradient } from '../../../utils/avatarGradient';

interface ProfileAvatarProps {
  name: string;
  avatarColor: string;
  avatarImage?: string;
  size?: number; // px, default 40
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export default function ProfileAvatar({
  name,
  avatarColor,
  avatarImage,
  size = 40,
  className = '',
  onClick,
  style,
}: ProfileAvatarProps) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const fontSize = Math.max(12, size * 0.4);

  if (avatarImage) {
    return (
      <div
        className={`rounded-full overflow-hidden flex-shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          cursor: onClick ? 'pointer' : undefined,
          ...style,
        }}
        onClick={onClick}
      >
        <img
          src={avatarImage}
          alt={name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarGradient(avatarColor),
        fontSize,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
      onClick={onClick}
    >
      {initials}
    </div>
  );
}
