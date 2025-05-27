use {
    crate::{model::MeshInfo, MaterialHandle},
    aleph_vk::PrimitiveTopology,
    glam::vec3,
};

pub fn cube() -> MeshInfo {
    let positions = vec![
        vec3(-0.5, -0.5, 0.5),
        vec3(-0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, -0.5, 0.5),
        vec3(-0.5, -0.5, -0.5),
        vec3(-0.5, 0.5, -0.5),
        vec3(0.5, 0.5, -0.5),
        vec3(0.5, -0.5, -0.5),
    ];
    let indices = vec![
        1, 0, 3, 3, 2, 1, 2, 3, 7, 7, 6, 2, 3, 0, 4, 4, 7, 3, 6, 2, 1, 1, 5, 6, 4, 5, 6, 6, 7, 4,
        5, 4, 0, 0, 1, 5,
    ];

    MeshInfo::default()
        .name("primitive-cube")
        .vertices(positions)
        .indices(indices)
        .topology(PrimitiveTopology::TRIANGLE_LIST)
        .material(MaterialHandle::null())
}
