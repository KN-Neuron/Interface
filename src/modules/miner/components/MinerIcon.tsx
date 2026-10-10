import minerImage from "../assets/miner.png";

export function MinerIcon() {
  return (
    <img
      src={minerImage}
      alt=""
      aria-hidden="true"
      className="miner-game__miner-image"
    />
  );
}