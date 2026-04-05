import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const FogSessionModule = buildModule("FogSessionModule", (m) => {
  const fogSession = m.contract("FogSession");

  return { fogSession };
});

export default FogSessionModule;