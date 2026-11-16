/**
 * Procedural models for Factory Twin. All models are presentational: animated ones take an
 * `anim` object (see anims.ts) that the sync layer mutates every frame.
 */
export * from './anims';
export * from './robotKinematics';
export { RobotArm, type RobotArmProps } from './RobotArm';
export { AssemblyMachine, ASSEMBLY_MACHINE_SIZE, ASSEMBLY_LIGHT_MOUNT, ASSEMBLY_FIXTURE_POS, type AssemblyMachineProps } from './AssemblyMachine';
export { StackLight, type StackLightProps } from './StackLight';
export { ConveyorLine, type ConveyorLineProps } from './ConveyorLine';
export { InspectionGantry, GANTRY_BED_TOP, type InspectionGantryProps } from './InspectionGantry';
export { PackagingMachine, PACKAGING_BED_TOP, PACKAGING_LENGTH, PACKAGING_LIGHT_MOUNT, packagingCartonX, type PackagingMachineProps } from './PackagingMachine';
export { Palletizer, PALLETIZER_PICK, type PalletizerProps } from './Palletizer';
export { AGV, AGV_DECK_TOP, AGV_TOTE_SLOTS, type AGVProps } from './AGV';
export { Forklift, FORKLIFT_LOAD_X, type ForkliftProps } from './Forklift';
export { Worker, type WorkerProps } from './Worker';
export { Truck, TRUCK_DECK_Y, TRUCK_LENGTH, truckPalletSlot, type TruckKind, type TruckProps } from './Truck';
export {
  StorageRack,
  KittingRack,
  KitTable,
  InfeedTable,
  RejectBin,
  RACK_LEVEL_PITCH,
  RACK_BASE_Y,
  rackSlotLocal,
  KIT_TABLE_TOP,
  KIT_TABLE_SLOTS,
  INFEED_TOP,
  REJECT_BIN_FLOOR,
  type StorageRackProps,
  type KitTableProps,
  type InfeedTableProps,
} from './Racks';
export * from './geometries';
export * from './materials';
