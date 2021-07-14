const runAsync = require("reactor-runasync");
const hashJs = require("hash.js");
const jsonSortify = require("json.sortify");
const { IotaAnchoringChannel } = require("@tangle-js/anchors");

const CONFIRMATION_ACTION_TYPE = "_sentToIOTA";

// @filter(onActionCreated) action.customFields.sendToIOTATest=true
const onActionCreated = (event) =>
  runAsync(async () => {
    logger.info(`Sending action ${event.action.id} to IOTA`);

    const action = event.action;
    const { target, targetType } = await readTarget(action);

    logger.info(`Target: ${JSON.stringify(target)}`);

    const channelDetails = await sendToIOTA(action, target);
    logger.info(`${JSON.stringify(channelDetails)}`);

    const updatedTarget = await updateTarget(target, targetType, channelDetails);

    const confirmationAction = await createConfirmation(action, updatedTarget, targetType);
    logger.info(`Confirmation action: ${confirmationAction.id}`);
  });

/**
 * Read the complete target object from the action.
 * This is either a Thng, product, or collection.
 *
 * @returns target that contains all data about the target and the target type
 */
async function readTarget(action) {
  if (action.thng) {
    targetType = "thng";
  } else if (action.product) {
    targetType = "product";
  } else if (action.collection) {
    targetType = "collection";
  } else {
    throw new Error("No target was specified!");
  }

  const target = await app[targetType](action[targetType]).read();

  return { target, targetType };
}

/**
 * Send the action's SHA 256 hash to IOTA.
 *
 * @param {object} action The concerned action
 * @param {object} target The target on which the action is executed
 *
 * @returns {object} the channel details
 */
async function sendToIOTA(action, target) {
  // Hash the action with SHA256
  const sha256 = hashJs.sha256().update(jsonSortify(action)).digest("hex");
  logger.debug(`Action SHA256: ${sha256}`);

  // We need to check whether a new channel is needed to be created or not
  let channelDetails =
    target.customFields && target.customFields.iotaAnchoringChannel;
  let channel;
  // The anchorage to be used to anchor this message (hash)
  let anchorageID;

  if (channelDetails) {
    const channelID = channelDetails.channelID;
    const seed = channelDetails.authorSeed;
    channel = IotaAnchoringChannel.fromID(channelID).bind(seed);
    anchorageID = channelDetails.nextAnchorageID;
  } else {
    // A new channel is bound and created
    channelDetails = {};
    channel = await IotaAnchoringChannel.bindNew();
    channelDetails.channelID = channel.channelID;
    channelDetails.seed = channel.seed;

    anchorageID = channel.firstAnchorageID;
  }

  const anchoringResult = await channel.anchor(
    Buffer.from(sha256),
    anchorageID
  );

  nextAnchorageID = anchoringResult.msgID;
  channelDetails.nextAnchorageID = nextAnchorageID;

  return channelDetails;
}

/**
 * Update the target with the channel details
 *
 * @param {object} target the item 
 * @param {string} targetType the type of item (thng, product, etc.)
 * @param {object} channelDetails - anchoring channel details from sendToIOTA().
 */
async function updateTarget(target, targetType, channelDetails) {
  const customFields = target.customFields || {};

  // We overwrite or assign the channel details
  customFields.iotaAnchoringChannel = channelDetails;

  const result = await app[targetType](target.id).update({ customFields });
  logger.info(`update result: ${JSON.stringify(result)}`);

  // The updated target
  target.customFields = customFields;

  return target;
}

/**
 * Create a confirmation action containing the original action
 *  and the IOTA anchoring channel ID
 *
 * @param {object} action The concerned action
 * @param {object} target The target on which the action was executed
 * @param {string} targetType the type of item (thng, product, etc.)
 *
 */
async function createConfirmation(action, target, targetType) {
  const payload = {
    type: CONFIRMATION_ACTION_TYPE,
    [targetType]: action[targetType],
    customFields: {
      originalAction: {
        type: action.type,
        id: action.id,
      },
      iotaAnchoringChannel: target.customFields.channelDetails.channelID,
    },
  };

  const newAction = await app.action(CONFIRMATION_ACTION_TYPE).create(payload);
  return newAction;
}
