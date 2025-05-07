use {
    aleph::prelude::*,
    aleph_core::{
        input::{Input, Key, MouseButton},
        system::{Res, ResMut, Schedule},
    },
    aleph_scene::{assets::Assets, gltf, NodeType, Scene},
    std::sync::{LazyLock, Mutex},
};

const DEFAULT_SCENE: usize = 86;
const SHIFT_FACTOR: usize = 10;
const ROTATION_FACTOR: f32 = 0.01;
const ZOOM_FACTOR: f32 = 0.1;

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));

#[derive(Default)]
struct State {
    scene_index: usize,
    auto_rotate: bool,
}

fn load_scene(index: usize, scene: &mut Scene, assets: &mut Assets) {
    let path = &SCENE_PATHS[index];
    let loaded = match gltf::load_scene(path, assets) {
        Ok(loaded) => loaded,
        Err(err) => {
            println!("Failed to load scene from {}: {}", path, err);
            Scene::default()
        }
    };
    *scene = loaded;
}

fn init_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>) {
    let mut state = STATE.lock().unwrap();
    state.scene_index = DEFAULT_SCENE;
    load_scene(state.scene_index, &mut scene, &mut assets);
}

fn input_system(mut scene: ResMut<Scene>, mut assets: ResMut<Assets>, input: Res<Input>) {
    let mut state = STATE.lock().unwrap();
    let n = (SHIFT_FACTOR * input.key_held(&Key::ShiftLeft) as usize).min(1);

    if input.key_pressed(&Key::ArrowLeft) {
        state.scene_index = state.scene_index - n % SCENE_PATHS.len();
        load_scene(state.scene_index, &mut scene, &mut assets);
    } else if input.key_pressed(&Key::ArrowRight) {
        state.scene_index = state.scene_index + n % SCENE_PATHS.len();
        load_scene(state.scene_index, &mut scene, &mut assets);
    }

    if input.key_pressed(&Key::KeyR) {
        state.auto_rotate = !state.auto_rotate;
    }

    if input.mouse_button_held(&MouseButton::Right) {
        let delta = input.mouse_delta();
        scene.camera.yaw_delta(delta.0 * n as f32 * ROTATION_FACTOR);
        scene
            .camera
            .pitch_delta(delta.1 * n as f32 * ROTATION_FACTOR);
    }

    if let Some(delta) = input.mouse_scroll_delta() {
        scene.camera.zoom(delta.1 * n as f32 * ZOOM_FACTOR);
    }

    if state.auto_rotate {
        scene.nodes_mut().for_each(|node| {
            if let NodeType::Mesh(_) = node.data {
                node.rotate(ROTATION_FACTOR);
            }
        });
    }
}

fn main() {
    let config = AppConfig::default().name("Demo");

    App::new(config)
        .with_system(Schedule::Startup, init_system)
        .with_system(Schedule::Default, input_system)
        .with_layer(RenderLayer::default())
        .run()
        .expect("Error running app");
}

const SCENE_PATHS: &[&str] = &[
    "submodules/glTF-Sample-Assets/Models/ABeautifulGame/glTF/ABeautifulGame.gltf",
    "submodules/glTF-Sample-Assets/Models/AlphaBlendModeTest/glTF/AlphaBlendModeTest.gltf",
    "submodules/glTF-Sample-Assets/Models/AnisotropyRotationTest/glTF/AnisotropyRotationTest.gltf",
    "submodules/glTF-Sample-Assets/Models/AnisotropyStrengthTest/glTF/AnisotropyStrengthTest.gltf",
    "submodules/glTF-Sample-Assets/Models/AntiqueCamera/glTF/AntiqueCamera.gltf",
    "submodules/glTF-Sample-Assets/Models/AttenuationTest/glTF/AttenuationTest.gltf",
    "submodules/glTF-Sample-Assets/Models/Avocado/glTF/Avocado.gltf",
    "submodules/glTF-Sample-Assets/Models/BarramundiFish/glTF/BarramundiFish.gltf",
    "submodules/glTF-Sample-Assets/Models/BoomBox/glTF/BoomBox.gltf",
    "submodules/glTF-Sample-Assets/Models/BoomBoxWithAxes/glTF/BoomBoxWithAxes.gltf",
    "submodules/glTF-Sample-Assets/Models/Box/glTF/Box.gltf",
    "submodules/glTF-Sample-Assets/Models/Box With Spaces/glTF/Box With Spaces.gltf",
    "submodules/glTF-Sample-Assets/Models/BoxAnimated/glTF/BoxAnimated.gltf",
    "submodules/glTF-Sample-Assets/Models/BoxInterleaved/glTF/BoxInterleaved.gltf",
    "submodules/glTF-Sample-Assets/Models/BoxTextured/glTF/BoxTextured.gltf",
    "submodules/glTF-Sample-Assets/Models/BoxTexturedNonPowerOfTwo/glTF/BoxTexturedNonPowerOfTwo.gltf",
    "submodules/glTF-Sample-Assets/Models/BoxVertexColors/glTF/BoxVertexColors.gltf",
    "submodules/glTF-Sample-Assets/Models/BrainStem/glTF/BrainStem.gltf",
    "submodules/glTF-Sample-Assets/Models/Cameras/glTF/Cameras.gltf",
    "submodules/glTF-Sample-Assets/Models/CarConcept/glTF/CarConcept.gltf",
    "submodules/glTF-Sample-Assets/Models/CarbonFibre/glTF/CarbonFibre.gltf",
    "submodules/glTF-Sample-Assets/Models/CesiumMan/glTF/CesiumMan.gltf",
    "submodules/glTF-Sample-Assets/Models/CesiumMilkTruck/glTF/CesiumMilkTruck.gltf",
    "submodules/glTF-Sample-Assets/Models/ChairDamaskPurplegold/glTF/ChairDamaskPurplegold.gltf",
    "submodules/glTF-Sample-Assets/Models/ClearCoatCarPaint/glTF/ClearCoatCarPaint.gltf",
    "submodules/glTF-Sample-Assets/Models/ClearCoatTest/glTF/ClearCoatTest.gltf",
    "submodules/glTF-Sample-Assets/Models/ClearcoatWicker/glTF/ClearcoatWicker.gltf",
    "submodules/glTF-Sample-Assets/Models/CommercialRefrigerator/glTF/CommercialRefrigerator.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareAlphaCoverage/glTF/CompareAlphaCoverage.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareAmbientOcclusion/glTF/CompareAmbientOcclusion.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareAnisotropy/glTF/CompareAnisotropy.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareBaseColor/glTF/CompareBaseColor.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareClearcoat/glTF/CompareClearcoat.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareDispersion/glTF/CompareDispersion.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareEmissiveStrength/glTF/CompareEmissiveStrength.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareIor/glTF/CompareIor.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareIridescence/glTF/CompareIridescence.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareMetallic/glTF/CompareMetallic.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareNormal/glTF/CompareNormal.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareRoughness/glTF/CompareRoughness.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareSheen/glTF/CompareSheen.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareSpecular/glTF/CompareSpecular.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareTransmission/glTF/CompareTransmission.gltf",
    "submodules/glTF-Sample-Assets/Models/CompareVolume/glTF/CompareVolume.gltf",
    "submodules/glTF-Sample-Assets/Models/Corset/glTF/Corset.gltf",
    "submodules/glTF-Sample-Assets/Models/Cube/glTF/Cube.gltf",
    "submodules/glTF-Sample-Assets/Models/DamagedHelmet/glTF/DamagedHelmet.gltf",
    "submodules/glTF-Sample-Assets/Models/DiffuseTransmissionPlant/glTF/DiffuseTransmissionPlant.gltf",
    "submodules/glTF-Sample-Assets/Models/DiffuseTransmissionTeacup/glTF/DiffuseTransmissionTeacup.gltf",
    "submodules/glTF-Sample-Assets/Models/DiffuseTransmissionTest/glTF/DiffuseTransmissionTest.gltf",
    "submodules/glTF-Sample-Assets/Models/DirectionalLight/glTF/DirectionalLight.gltf",
    "submodules/glTF-Sample-Assets/Models/DispersionTest/glTF/DispersionTest.gltf",
    "submodules/glTF-Sample-Assets/Models/DragonAttenuation/glTF/DragonAttenuation.gltf",
    "submodules/glTF-Sample-Assets/Models/DragonDispersion/glTF/DragonDispersion.gltf",
    "submodules/glTF-Sample-Assets/Models/Duck/glTF/Duck.gltf",
    "submodules/glTF-Sample-Assets/Models/EmissiveStrengthTest/glTF/EmissiveStrengthTest.gltf",
    "submodules/glTF-Sample-Assets/Models/EnvironmentTest/glTF/EnvironmentTest.gltf",
    "submodules/glTF-Sample-Assets/Models/FlightHelmet/glTF/FlightHelmet.gltf",
    "submodules/glTF-Sample-Assets/Models/Fox/glTF/Fox.gltf",
    "submodules/glTF-Sample-Assets/Models/GlamVelvetSofa/glTF/GlamVelvetSofa.gltf",
    "submodules/glTF-Sample-Assets/Models/GlassBrokenWindow/glTF/GlassBrokenWindow.gltf",
    "submodules/glTF-Sample-Assets/Models/GlassHurricaneCandleHolder/glTF/GlassHurricaneCandleHolder.gltf",
    "submodules/glTF-Sample-Assets/Models/GlassVaseFlowers/glTF/GlassVaseFlowers.gltf",
    "submodules/glTF-Sample-Assets/Models/IORTestGrid/glTF/IORTestGrid.gltf",
    "submodules/glTF-Sample-Assets/Models/InterpolationTest/glTF/InterpolationTest.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescenceAbalone/glTF/IridescenceAbalone.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescenceDielectricSpheres/glTF/IridescenceDielectricSpheres.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescenceLamp/glTF/IridescenceLamp.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescenceMetallicSpheres/glTF/IridescenceMetallicSpheres.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescenceSuzanne/glTF/IridescenceSuzanne.gltf",
    "submodules/glTF-Sample-Assets/Models/IridescentDishWithOlives/glTF/IridescentDishWithOlives.gltf",
    "submodules/glTF-Sample-Assets/Models/Lantern/glTF/Lantern.gltf",
    "submodules/glTF-Sample-Assets/Models/LightsPunctualLamp/glTF/LightsPunctualLamp.gltf",
    "submodules/glTF-Sample-Assets/Models/MandarinOrange/glTF/MandarinOrange.gltf",
    "submodules/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf",
    "submodules/glTF-Sample-Assets/Models/MeshPrimitiveModes/glTF/MeshPrimitiveModes.gltf",
    "submodules/glTF-Sample-Assets/Models/MetalRoughSpheres/glTF/MetalRoughSpheres.gltf",
    "submodules/glTF-Sample-Assets/Models/MetalRoughSpheresNoTextures/glTF/MetalRoughSpheresNoTextures.gltf",
    "submodules/glTF-Sample-Assets/Models/MorphPrimitivesTest/glTF/MorphPrimitivesTest.gltf",
    "submodules/glTF-Sample-Assets/Models/MorphStressTest/glTF/MorphStressTest.gltf",
    "submodules/glTF-Sample-Assets/Models/MosquitoInAmber/glTF/MosquitoInAmber.gltf",
    "submodules/glTF-Sample-Assets/Models/MultiUVTest/glTF/MultiUVTest.gltf",
    "submodules/glTF-Sample-Assets/Models/MultipleScenes/glTF/MultipleScenes.gltf",
    "submodules/glTF-Sample-Assets/Models/NegativeScaleTest/glTF/NegativeScaleTest.gltf",
    "submodules/glTF-Sample-Assets/Models/NormalTangentMirrorTest/glTF/NormalTangentMirrorTest.gltf",
    "submodules/glTF-Sample-Assets/Models/NormalTangentTest/glTF/NormalTangentTest.gltf",
    "submodules/glTF-Sample-Assets/Models/OrientationTest/glTF/OrientationTest.gltf",
    "submodules/glTF-Sample-Assets/Models/PointLightIntensityTest/glTF/PointLightIntensityTest.gltf",
    "submodules/glTF-Sample-Assets/Models/PotOfCoals/glTF/PotOfCoals.gltf",
    "submodules/glTF-Sample-Assets/Models/PotOfCoalsAnimationPointer/glTF/PotOfCoalsAnimationPointer.gltf",
    "submodules/glTF-Sample-Assets/Models/PrimitiveModeNormalsTest/glTF/PrimitiveModeNormalsTest.gltf",
    "submodules/glTF-Sample-Assets/Models/RecursiveSkeletons/glTF/RecursiveSkeletons.gltf",
    "submodules/glTF-Sample-Assets/Models/RiggedFigure/glTF/RiggedFigure.gltf",
    "submodules/glTF-Sample-Assets/Models/RiggedSimple/glTF/RiggedSimple.gltf",
    "submodules/glTF-Sample-Assets/Models/SciFiHelmet/glTF/SciFiHelmet.gltf",
    "submodules/glTF-Sample-Assets/Models/SheenChair/glTF/SheenChair.gltf",
    "submodules/glTF-Sample-Assets/Models/SheenCloth/glTF/SheenCloth.gltf",
    "submodules/glTF-Sample-Assets/Models/SheenTestGrid/glTF/SheenTestGrid.gltf",
    "submodules/glTF-Sample-Assets/Models/SheenWoodLeatherSofa/glTF/SheenWoodLeatherSofa.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleInstancing/glTF/SimpleInstancing.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleMaterial/glTF/SimpleMaterial.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleMeshes/glTF/SimpleMeshes.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleMorph/glTF/SimpleMorph.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleSkin/glTF/SimpleSkin.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleSparseAccessor/glTF/SimpleSparseAccessor.gltf",
    "submodules/glTF-Sample-Assets/Models/SimpleTexture/glTF/SimpleTexture.gltf",
    "submodules/glTF-Sample-Assets/Models/SpecGlossVsMetalRough/glTF/SpecGlossVsMetalRough.gltf",
    "submodules/glTF-Sample-Assets/Models/SpecularSilkPouf/glTF/SpecularSilkPouf.gltf",
    "submodules/glTF-Sample-Assets/Models/SpecularTest/glTF/SpecularTest.gltf",
    "submodules/glTF-Sample-Assets/Models/Sponza/glTF/Sponza.gltf",
    "submodules/glTF-Sample-Assets/Models/StainedGlassLamp/glTF/StainedGlassLamp.gltf",
    "submodules/glTF-Sample-Assets/Models/SunglassesKhronos/glTF/SunglassesKhronos.gltf",
    "submodules/glTF-Sample-Assets/Models/Suzanne/glTF/Suzanne.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureCoordinateTest/glTF/TextureCoordinateTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureEncodingTest/glTF/TextureEncodingTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureLinearInterpolationTest/glTF/TextureLinearInterpolationTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureSettingsTest/glTF/TextureSettingsTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureTransformMultiTest/glTF/TextureTransformMultiTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TextureTransformTest/glTF/TextureTransformTest.gltf",
    "submodules/glTF-Sample-Assets/Models/ToyCar/glTF/ToyCar.gltf",
    "submodules/glTF-Sample-Assets/Models/TransmissionRoughnessTest/glTF/TransmissionRoughnessTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TransmissionTest/glTF/TransmissionTest.gltf",
    "submodules/glTF-Sample-Assets/Models/TransmissionThinwallTestGrid/glTF/TransmissionThinwallTestGrid.gltf",
    "submodules/glTF-Sample-Assets/Models/Triangle/glTF/Triangle.gltf",
    "submodules/glTF-Sample-Assets/Models/TriangleWithoutIndices/glTF/TriangleWithoutIndices.gltf",
    "submodules/glTF-Sample-Assets/Models/TwoSidedPlane/glTF/TwoSidedPlane.gltf",
    "submodules/glTF-Sample-Assets/Models/Unicode❤♻Test/glTF/Unicode❤♻Test.gltf",
    "submodules/glTF-Sample-Assets/Models/UnlitTest/glTF/UnlitTest.gltf",
    "submodules/glTF-Sample-Assets/Models/VertexColorTest/glTF/VertexColorTest.gltf",
    "submodules/glTF-Sample-Assets/Models/VirtualCity/glTF/VirtualCity.gltf",
    "submodules/glTF-Sample-Assets/Models/WaterBottle/glTF/WaterBottle.gltf",
    "submodules/glTF-Sample-Assets/Models/XmpMetadataRoundedCube/glTF/XmpMetadataRoundedCube.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_Sparse/Accessor_Sparse_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_Sparse/Accessor_Sparse_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_Sparse/Accessor_Sparse_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_Sparse/Accessor_Sparse_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Accessor_SparseType/Accessor_SparseType_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Node/Animation_Node_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_NodeMisc/Animation_NodeMisc_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SamplerType/Animation_SamplerType_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SamplerType/Animation_SamplerType_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SamplerType/Animation_SamplerType_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_Skin/Animation_Skin_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SkinType/Animation_SkinType_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SkinType/Animation_SkinType_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SkinType/Animation_SkinType_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Animation_SkinType/Animation_SkinType_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Interleaved/Buffer_Interleaved_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Interleaved/Buffer_Interleaved_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Interleaved/Buffer_Interleaved_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Interleaved/Buffer_Interleaved_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Interleaved/Buffer_Interleaved_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Buffer_Misc/Buffer_Misc_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Compatibility/Compatibility_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_12.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Instancing/Instancing_13.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material/Material_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaBlend/Material_AlphaBlend_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_AlphaMask/Material_AlphaMask_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_DoubleSided/Material_DoubleSided_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_DoubleSided/Material_DoubleSided_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_DoubleSided/Material_DoubleSided_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_DoubleSided/Material_DoubleSided_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_DoubleSided/Material_DoubleSided_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_MetallicRoughness/Material_MetallicRoughness_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_Mixed/Material_Mixed_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_Mixed/Material_Mixed_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_Mixed/Material_Mixed_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_12.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Material_SpecularGlossiness/Material_SpecularGlossiness_13.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveAttribute/Mesh_PrimitiveAttribute_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_12.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_13.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_14.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveMode/Mesh_PrimitiveMode_15.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitiveVertexColor/Mesh_PrimitiveVertexColor_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_Primitives/Mesh_Primitives_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Mesh_PrimitivesUV/Mesh_PrimitivesUV_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_Attribute/Node_Attribute_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Node_NegativeScale/Node_NegativeScale_12.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_00.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_01.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_02.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_03.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_04.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_05.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_06.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_07.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_08.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_09.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_10.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_11.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_12.gltf",
    "submodules/glTF-Asset-Generator/Output/Positive/Texture_Sampler/Texture_Sampler_13.gltf",
];

// fn glob_files(state: &mut State) {
//     state.scene_paths = SCENE_PATHS
//         .iter()
//         .flat_map(|p| {
//             glob::glob(p)
//                 .expect("Failed to read glob")
//                 .filter_map(|entry| entry.ok())
//                 .map(|path| path.display().to_string())
//                 .collect::<Vec<_>>()
//         })
//         .collect();

//     log::info!("Found {} scene files", state.scene_paths.len());
//     for (i, path) in state.scene_paths.iter().enumerate() {
//         log::info!("  {} -> {}", i, path);
//     }
// }
// // let x_axis = primitives::cube(5.0, 0.2, 0.2, [1.0, 0.0, 0.0, 1.0]);
// // let x_handle = assets.add_mesh(x_axis).unwrap();
// // let x_node = Node::new("cylinder", NodeType::Mesh(x_handle));
// // let y_axis = primitives::cube(0.2, 5.0, 0.2, [0.0, 1.0, 0.0, 1.0]);
// // let y_handle = assets.add_mesh(y_axis).unwrap();
// // let y_node = Node::new("cylinder", NodeType::Mesh(y_handle));
// // let z_axis = primitives::cube(0.2, 0.2, 5.0, [0.0, 0.0, 1.0, 1.0]);
// // let z_handle = assets.add_mesh(z_axis).unwrap();
// // let z_node = Node::new("cylinder", NodeType::Mesh(z_handle));

// let x_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
// let x_handle = assets.add_mesh(x_cube).unwrap();
// let mut x_cube_node = Node::new("cube", NodeType::Mesh(x_handle));
// x_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(-5.0, 0.0, 0.0));

// let y_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
// let y_handle = assets.add_mesh(y_cube).unwrap();
// let mut y_cube_node = Node::new("cube", NodeType::Mesh(y_handle));
// y_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(0.0, 4.0, 0.0));

// let z_cube = primitives::cube(1.0, 1.0, 1.0, [1.0, 1.0, 1.0, 1.0]);
// let z_handle = assets.add_mesh(z_cube).unwrap();
// let mut z_cube_node = Node::new("cube", NodeType::Mesh(z_handle));
// z_cube_node.transform = glam::Mat4::from_translation(glam::Vec3::new(0.0, 0.0, 3.0));

// // scene.attach_root(x_node).unwrap();
// // scene.attach_root(y_node).unwrap();
// // scene.attach_root(z_node).unwrap();
// scene.attach_root(x_cube_node).unwrap();
// scene.attach_root(y_cube_node).unwrap();
// scene.attach_root(z_cube_node).unwrap();
