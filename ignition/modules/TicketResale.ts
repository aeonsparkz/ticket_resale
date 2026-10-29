import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys the platform: EventFactory, which deploys the single Marketplace in its constructor (D2).
// Events are created afterwards by organizers calling factory.createEvent, not by this module.
export default buildModule("TicketResaleModule", (m) => {
  const factory = m.contract("EventFactory");
  const marketplace = m.contractAt("Marketplace", m.staticCall(factory, "marketplace"));

  return { factory, marketplace };
});
