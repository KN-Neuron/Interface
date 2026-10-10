interface BrainLogoProps {
  size?: number;
}

export function BrainLogo({ size = 54 }: BrainLogoProps) {
  return (
    <img
      src="/brain-logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        display: "block",
        objectFit: "contain",
      }}
    />
  );
}
