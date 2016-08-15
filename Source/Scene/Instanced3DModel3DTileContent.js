/*global define*/
define([
        '../Core/AttributeCompression',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Color',
        '../Core/ComponentDatatype',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/Ellipsoid',
        '../Core/getMagic',
        '../Core/getStringFromTypedArray',
        '../Core/joinUrls',
        '../Core/loadArrayBuffer',
        '../Core/Matrix3',
        '../Core/Matrix4',
        '../Core/Math',
        '../Core/Quaternion',
        '../Core/Request',
        '../Core/RequestScheduler',
        '../Core/RequestType',
        '../Core/Transforms',
        '../Core/TranslationRotationScale',
        '../ThirdParty/Uri',
        '../ThirdParty/when',
        './Cesium3DTileFeature',
        './Cesium3DTileBatchTableResources',
        './Cesium3DTileContentState',
        './Cesium3DTileFeatureTableResources',
        './ModelInstanceCollection'
    ], function(
        AttributeCompression,
        Cartesian2,
        Cartesian3,
        Color,
        ComponentDatatype,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        Ellipsoid,
        getMagic,
        getStringFromTypedArray,
        joinUrls,
        loadArrayBuffer,
        Matrix3,
        Matrix4,
        CesiumMath,
        Quaternion,
        Request,
        RequestScheduler,
        RequestType,
        Transforms,
        TranslationRotationScale,
        Uri,
        when,
        Cesium3DTileFeature,
        Cesium3DTileBatchTableResources,
        Cesium3DTileContentState,
        Cesium3DTileFeatureTableResources,
        ModelInstanceCollection) {
    'use strict';

    /**
     * Represents the contents of a
     * {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/TileFormats/Instanced3DModel/README.md|Instanced 3D Model}
     * tile in a {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/README.md|3D Tiles} tileset.
     *
     * @alias Instanced3DModel3DTileContent
     * @constructor
     *
     * @private
     */
    function Instanced3DModel3DTileContent(tileset, tile, url) {
        this._modelInstanceCollection = undefined;
        this._url = url;
        this._tileset = tileset;
        this._tile = tile;

        /**
         * The following properties are part of the {@link Cesium3DTileContent} interface.
         */
        this.state = Cesium3DTileContentState.UNLOADED;
        this.batchTableResources = undefined;
        this.featurePropertiesDirty = false;

        this._contentReadyToProcessPromise = when.defer();
        this._readyPromise = when.defer();
        this._features = undefined;
    }

    defineProperties(Instanced3DModel3DTileContent.prototype, {
        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        featuresLength : {
            get : function() {
                return this._modelInstanceCollection.length;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        innerContents : {
            get : function() {
                return undefined;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        contentReadyToProcessPromise : {
            get : function() {
                return this._contentReadyToProcessPromise.promise;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        }
    });

    function createFeatures(content) {
        var tileset = content._tileset;
        var featuresLength = content.featuresLength;
        if (!defined(content._features) && (featuresLength > 0)) {
            var features = new Array(featuresLength);
            for (var i = 0; i < featuresLength; ++i) {
                features[i] = new Cesium3DTileFeature(tileset, content, i);
            }
            content._features = features;
        }
    }

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.hasProperty = function(name) {
        return this.batchTableResources.hasProperty(name);
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.getFeature = function(batchId) {
        var featuresLength = this._modelInstanceCollection.length;
        //>>includeStart('debug', pragmas.debug);
        if (!defined(batchId) || (batchId < 0) || (batchId >= featuresLength)) {
            throw new DeveloperError('batchId is required and between zero and featuresLength - 1 (' + (featuresLength - 1) + ').');
        }
        //>>includeEnd('debug');

        createFeatures(this);
        return this._features[batchId];
    };

    var sizeOfUint32 = Uint32Array.BYTES_PER_ELEMENT;

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.request = function() {
        var that = this;
        var distance = this._tile.distanceToCamera;
        var promise = RequestScheduler.schedule(new Request({
            url : this._url,
            server : this._tile.requestServer,
            requestFunction : loadArrayBuffer,
            type : RequestType.TILES3D,
            distance : distance
        }));

        if (!defined(promise)) {
            return false;
        }

        this.state = Cesium3DTileContentState.LOADING;
        promise.then(function(arrayBuffer) {
            if (that.isDestroyed()) {
                return when.reject('tileset is destroyed');
            }
            that.initialize(arrayBuffer);
        }).otherwise(function(error) {
            that.state = Cesium3DTileContentState.FAILED;
            that._readyPromise.reject(error);
        });
        return true;
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.initialize = function(arrayBuffer, byteOffset) {
        byteOffset = defaultValue(byteOffset, 0);

        var uint8Array = new Uint8Array(arrayBuffer);
        var magic = getMagic(uint8Array, byteOffset);
        if (magic !== 'i3dm') {
            throw new DeveloperError('Invalid Instanced 3D Model. Expected magic=i3dm. Read magic=' + magic);
        }

        var view = new DataView(arrayBuffer);
        byteOffset += sizeOfUint32;  // Skip magic number

        var version = view.getUint32(byteOffset, true);
        //>>includeStart('debug', pragmas.debug);
        if (version !== 1) {
            throw new DeveloperError('Only Instanced 3D Model version 1 is supported. Version ' + version + ' is not.');
        }
        //>>includeEnd('debug');
        byteOffset += sizeOfUint32;

        // Skip byteLength
        byteOffset += sizeOfUint32;

        var featureTableJSONByteLength = view.getUint32(byteOffset, true);
        //>>includeStart('debug', pragmas.debug);
        if (featureTableJSONByteLength === 0) {
            throw new DeveloperError('featureTableJSONByteLength is zero, the feature table must be defined.');
        }
        //>>includeEnd('debug');
        byteOffset += sizeOfUint32;

        var featureTableBinaryByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var batchTableJSONByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var batchTableBinaryByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var gltfByteLength = view.getUint32(byteOffset, true);
        //>>includeStart('debug', pragmas.debug);
        if (gltfByteLength === 0) {
            throw new DeveloperError('glTF byte length is zero, i3dm must have a glTF to instance.');
        }
        //>>includeEnd('debug');
        byteOffset += sizeOfUint32;
        
        var gltfFormat = view.getUint32(byteOffset, true);
        //>>includeStart('debug', pragmas.debug);
        if (gltfFormat !== 1 && gltfFormat !== 0) {
            throw new DeveloperError('Only glTF format 0 (uri) or 1 (embedded) are supported. Format ' + gltfFormat + ' is not.');
        }
        //>>includeEnd('debug');
        byteOffset += sizeOfUint32;

        if (featureTableJSONByteLength > 0) {
            var featureTableString = getStringFromTypedArray(uint8Array, byteOffset, featureTableJSONByteLength);
            var featureTableJSON = JSON.parse(featureTableString);
            byteOffset += featureTableJSONByteLength;

            var featureTableBinary = new Uint8Array(arrayBuffer, byteOffset, featureTableBinaryByteLength);
            byteOffset += featureTableBinaryByteLength;

            var featureTableResources = new Cesium3DTileFeatureTableResources(featureTableJSON, featureTableBinary);
            var instancesLength = featureTableResources.getGlobalProperty('INSTANCES_LENGTH', ComponentDatatype.UNSIGNED_INT);
            if (Array.isArray(instancesLength)) {
                instancesLength = instancesLength;
            }
            featureTableResources.featuresLength = instancesLength;

            //>>includeStart('debug', pragmas.debug);
            if (!defined(instancesLength)) {
                throw new DeveloperError('Feature table global property: INSTANCES_LENGTH must be defined');
            }
            //>>includeEnd('debug');

            var batchTableResources = new Cesium3DTileBatchTableResources(this, instancesLength);
            this.batchTableResources = batchTableResources;
            if (batchTableJSONByteLength > 0) {
                var batchTableString = getStringFromTypedArray(uint8Array, byteOffset, batchTableJSONByteLength);
                batchTableResources.batchTable = JSON.parse(batchTableString);
                byteOffset += batchTableJSONByteLength;
            }

            // TODO: Right now batchTableResources doesn't support binary
            byteOffset += batchTableBinaryByteLength;

            var gltfView = new Uint8Array(arrayBuffer, byteOffset, gltfByteLength);
            byteOffset += gltfByteLength;

            // Create model instance collection
            var collectionOptions = {
                instances : new Array(instancesLength),
                batchTableResources : batchTableResources,
                boundingVolume : this._tile.contentBoundingVolume.boundingVolume,
                cull : false,
                url : undefined,
                headers : undefined,
                type : RequestType.TILES3D,
                gltf : undefined,
                basePath : undefined
            };

            if (gltfFormat === 0) {
                var gltfUrl = getStringFromTypedArray(gltfView);
                var baseUrl = defaultValue(this._tileset.baseUrl, '');
                collectionOptions.url = joinUrls(baseUrl, gltfUrl);
            } else {
                collectionOptions.gltf = gltfView;
                collectionOptions.basePath = this._url;
            }

            var instances = collectionOptions.instances;
            var instancePosition = new Cartesian3();
            var instancePositionArray = new Array(3);
            var instanceNormalRight = new Cartesian3();
            var instanceNormalUp = new Cartesian3();
            var instanceNormalForward = new Cartesian3();
            var instanceRotation = new Matrix3();
            var instanceQuaternion = new Quaternion();
            var instanceScale = new Cartesian3();
            var instanceTranslationRotationScale = new TranslationRotationScale();
            var instanceTransform = new Matrix4();
            for (var i = 0; i < instancesLength; i++) {
                // Get the instance position
                var position = featureTableResources.getProperty('POSITION', i, ComponentDatatype.FLOAT, 3);
                if (!defined(position)) {
                    position = instancePositionArray;
                    var positionQuantized = featureTableResources.getProperty('POSITION_QUANTIZED', i, ComponentDatatype.UNSIGNED_SHORT, 3);
                    //>>includeStart('debug', pragmas.debug);
                    if (!defined(positionQuantized)) {
                        throw new DeveloperError('Either POSITION or POSITION_QUANTIZED must be defined for each instance.');
                    }
                    //>>includeEnd('debug');
                    var quantizedVolumeOffset = featureTableResources.getGlobalProperty('QUANTIZED_VOLUME_OFFSET', ComponentDatatype.FLOAT, 3);
                    //>>includeStart('debug', pragmas.debug);
                    if (!defined(quantizedVolumeOffset)) {
                        throw new DeveloperError('Global property: QUANTIZED_VOLUME_OFFSET must be defined for quantized positions.');
                    }
                    //>>includeEnd('debug');
                    var quantizedVolumeScale = featureTableResources.getGlobalProperty('QUANTIZED_VOLUME_SCALE', ComponentDatatype.FLOAT, 3);
                    //>>includeStart('debug', pragmas.debug);
                    if (!defined(quantizedVolumeScale)) {
                        throw new DeveloperError('Global property: QUANTIZED_VOLUME_SCALE must be defined for quantized positions.');
                    }
                    //>>includeEnd('debug');
                    for (var j = 0; j < 3; j++) {
                        position[j] = (positionQuantized[j] / 65535.0 * quantizedVolumeScale[j]) + quantizedVolumeOffset[j];
                    }
                }
                Cartesian3.unpack(position, 0, instancePosition);
                instanceTranslationRotationScale.translation = instancePosition;

                // Get the instance rotation
                var normalUp = featureTableResources.getProperty('NORMAL_UP', i, ComponentDatatype.FLOAT, 3);
                var normalRight = featureTableResources.getProperty('NORMAL_RIGHT', i, ComponentDatatype.FLOAT, 3);
                var hasCustomOrientation = false;
                if (defined(normalUp)) {
                    //>>includeStart('debug', pragmas.debug);
                    if (!defined(normalRight)) {
                        throw new DeveloperError('To define a custom orientation, both NORMAL_UP and NORMAL_RIGHT must be defined.');
                    }
                    //>>includeEnd('debug');
                    Cartesian3.unpack(normalUp, 0, instanceNormalUp);
                    Cartesian3.unpack(normalRight, 0, instanceNormalRight);
                    hasCustomOrientation = true;
                } else {
                    var octNormalUp = featureTableResources.getProperty('NORMAL_UP_OCT32P', i, ComponentDatatype.UNSIGNED_SHORT, 2);
                    var octNormalRight = featureTableResources.getProperty('NORMAL_RIGHT_OCT32P', i, ComponentDatatype.UNSIGNED_SHORT, 2);
                    if (defined(octNormalUp)) {
                        //>>includeStart('debug', pragmas.debug);
                        if (!defined(octNormalRight)) {
                            throw new DeveloperError('To define a custom orientation with oct-encoded vectors, both NORMAL_UP_OCT32P and NORMAL_RIGHT_OCT32P must be defined.');
                        }
                        //>>includeEnd('debug');
                        AttributeCompression.octDecodeInRange(octNormalUp[0], octNormalUp[1], 65535, instanceNormalUp);
                        AttributeCompression.octDecodeInRange(octNormalRight[0], octNormalRight[1], 65535, instanceNormalRight);
                        hasCustomOrientation = true;
                    } else {
                        // Custom orientation is not defined, default to WGS84
                        Transforms.eastNorthUpToFixedFrame(instancePosition, Ellipsoid.WGS84, instanceTransform);
                        Matrix4.getRotation(instanceTransform, instanceRotation);
                    }
                }
                if (hasCustomOrientation) {
                    Cartesian3.cross(instanceNormalRight, instanceNormalUp, instanceNormalForward);
                    Cartesian3.normalize(instanceNormalForward, instanceNormalForward);
                    Matrix3.setColumn(instanceRotation, 0, instanceNormalRight, instanceRotation);
                    Matrix3.setColumn(instanceRotation, 1, instanceNormalUp, instanceRotation);
                    Matrix3.setColumn(instanceRotation, 2, instanceNormalForward, instanceRotation);
                }
                Quaternion.fromRotationMatrix(instanceRotation, instanceQuaternion);
                instanceTranslationRotationScale.rotation = instanceQuaternion;

                // Get the instance scale
                instanceScale.x = 1.0;
                instanceScale.y = 1.0;
                instanceScale.z = 1.0;
                var scale = featureTableResources.getProperty('SCALE', i, ComponentDatatype.FLOAT);
                if (defined(scale)) {
                    Cartesian3.multiplyByScalar(instanceScale, scale, instanceScale);
                }
                var nonUniformScale = featureTableResources.getProperty('SCALE_NON_UNIFORM', i, ComponentDatatype.FLOAT, 3);
                if (defined(nonUniformScale)) {
                    instanceScale.x *= nonUniformScale[0];
                    instanceScale.y *= nonUniformScale[1];
                    instanceScale.z *= nonUniformScale[2];
                }
                instanceTranslationRotationScale.scale = instanceScale;

                // Get the batchId
                var batchId = featureTableResources.getProperty('BATCH_ID', i , ComponentDatatype.UNSIGNED_SHORT);
                if (!defined(batchId)) {
                    // If BATCH_ID semantic is undefined, batchId is just the instance number
                    batchId = [i];
                }
                // Create the model matrix and the instance
                Matrix4.fromTranslationRotationScale(instanceTranslationRotationScale, instanceTransform);
                var modelMatrix = instanceTransform.clone();
                instances[i] = {
                    modelMatrix : modelMatrix,
                    batchId : batchId
                };
            }

            var modelInstanceCollection = new ModelInstanceCollection(collectionOptions);
            this._modelInstanceCollection = modelInstanceCollection;
            this.state = Cesium3DTileContentState.PROCESSING;
            this.contentReadyToProcessPromise.resolve(this);

            var that = this;

            modelInstanceCollection.readyPromise.then(function(modelInstanceCollection) {
                that.state = Cesium3DTileContentState.READY;
                that.readyPromise.resolve(that);
            }).otherwise(function(error) {
                that.state = Cesium3DTileContentState.FAILED;
                that.readyPromise.reject(error);
            });
        }
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.applyDebugSettings = function(enabled, color) {
        color = enabled ? color : Color.WHITE;
        this.batchTableResources.setAllColor(color);
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.update = function(tileset, frameState) {
        var oldAddCommand = frameState.addCommand;
        if (frameState.passes.render) {
            frameState.addCommand = this.batchTableResources.getAddCommand();
        }

        // In the PROCESSING state we may be calling update() to move forward
        // the content's resource loading.  In the READY state, it will
        // actually generate commands.
        this.batchTableResources.update(tileset, frameState);
        this._modelInstanceCollection.update(frameState);

        frameState.addCommand = oldAddCommand;
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Instanced3DModel3DTileContent.prototype.destroy = function() {
        this._modelInstanceCollection = this._modelInstanceCollection && this._modelInstanceCollection.destroy();
        this.batchTableResources = this.batchTableResources && this.batchTableResources.destroy();

        return destroyObject(this);
    };
    return Instanced3DModel3DTileContent;
});
