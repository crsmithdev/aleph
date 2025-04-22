use std::{
    any::{Any, TypeId},
    cell::{Ref, RefCell, RefMut},
    collections::HashMap,
    marker::PhantomData,
    ops::{Deref, DerefMut},
};

pub trait System {
    fn run(&mut self, resources: &mut Resources);
    fn name(&self) -> &str;
}

pub trait IntoSystem<Input> {
    type System: System;

    fn into_system(self) -> Self::System;
}

pub struct FunctionSystem<Input, F> {
    name: String,
    f: F,
    marker: PhantomData<fn() -> Input>,
}

type StoredSystem = Box<dyn for<'a> System>;

pub struct Res<'a, T: 'static> {
    value: Ref<'a, Box<dyn Any>>,
    _marker: PhantomData<&'a T>,
}

pub trait SystemParam {
    type Item<'new>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r>;
}

impl<'res, T: 'static> SystemParam for Res<'res, T> {
    type Item<'new> = Res<'new, T>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r> { resources.get::<T>() }
}

impl<T: 'static> Deref for Res<'_, T> {
    type Target = T;

    fn deref(&self) -> &T { self.value.downcast_ref().unwrap() }
}
pub struct ResMut<'a, T: 'static> {
    value: RefMut<'a, Box<dyn Any>>,
    _marker: PhantomData<&'a mut T>,
}

impl<T: 'static> Deref for ResMut<'_, T> {
    type Target = T;

    fn deref(&self) -> &T { self.value.downcast_ref().unwrap() }
}

impl<T: 'static> DerefMut for ResMut<'_, T> {
    fn deref_mut(&mut self) -> &mut T { self.value.downcast_mut().unwrap() }
}

impl<'res, T: 'static> SystemParam for ResMut<'res, T> {
    type Item<'new> = ResMut<'new, T>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r> { resources.get_mut::<T>() }
}

#[derive(Default)]
pub struct Resources {
    resources: HashMap<TypeId, RefCell<Box<dyn Any>>>,
}

impl Resources {
    pub fn new() -> Self {
        Self {
            resources: HashMap::new(),
        }
    }

    pub fn add<R: 'static>(&mut self, res: R) {
        self.resources
            .insert(TypeId::of::<R>(), RefCell::new(Box::new(res)));
    }

    pub fn get<'a, T: 'static>(&'a self) -> Res<'a, T> {
        let type_id = TypeId::of::<T>();
        let resource = self.resources.get(&type_id).expect("Resource not found");
        Res {
            value: resource.borrow(),
            _marker: PhantomData,
        }
    }

    pub fn get_mut<'a, T: 'static>(&'a self) -> ResMut<'a, T> {
        let type_id = TypeId::of::<T>();
        let resource = self.resources.get(&type_id).expect("Resource not found");
        ResMut {
            value: resource.borrow_mut(),
            _marker: PhantomData,
        }
    }
}

#[derive(Default)]
pub struct Scheduler {
    pub systems: HashMap<Schedule, Vec<StoredSystem>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Schedule {
    Default,
    Startup,
}

impl Scheduler {
    pub fn run(&mut self, schedule: Schedule, resources: &mut Resources) {
        if let Some(systems) = self.systems.get_mut(&schedule) {
            for system in systems {
                log::trace!("Running {:?} -> {}", schedule, system.name());
                system.run(resources);
            }
        }
    }

    pub fn add_system<I, S: System + 'static>(
        &mut self,
        schedule: Schedule,
        system: impl IntoSystem<I, System = S>,
    ) {
        let entry = self.systems.entry(schedule).or_default();
        entry.push(Box::new(system.into_system()));
    }

    // pub fn add_resource<R: 'static>(&mut self, res: R) { self.resources.add(res); }
    // pub fn get<'a, T: 'static>(&'a self) -> ResMut<'a, T> { self.resources.get_mut::<T>() }
}

macro_rules! impl_system2 {
    ($($params:ident),*) => {
        #[allow(unused_parens)]
        #[allow(unused_variables)]
        #[allow(non_snake_case)]
        impl<F, $($params : SystemParam ),*> System for FunctionSystem<($($params),*), F>
        where
            for<'a, 'b> &'a mut F:
                FnMut($($params),*) + FnMut($(<$params as SystemParam>::Item<'b>),*),
        {
            fn name(&self) -> &str { &self.name }

            fn run(&mut self, resources: &mut Resources) {
                fn call_inner<$($params),*>(mut f: impl FnMut($($params),*), $($params: $params),*) { f($($params),*) }
                $(

                    let $params = $params::retrieve(resources);
                )*

                call_inner(&mut self.f, $($params),*)
            }
        }

        #[allow(unused_parens)]
        #[allow(unused_variables)]
        #[allow(non_snake_case)]
        impl<F: FnMut($($params),*), $($params : SystemParam),*> IntoSystem<($($params),*)> for F
        where
            for<'a, 'b> &'a mut F:
                FnMut($($params),*) + FnMut($(<$params as SystemParam>::Item<'b>),*),
        {
            type System = FunctionSystem<($($params),*), Self>;

            fn into_system(self) -> Self::System {
                FunctionSystem {
                    name: std::any::type_name_of_val(&self).to_string(),
                    f: self,
                    marker: Default::default(),
                }
            }
        }
    };
}

impl_system2!(T1);
impl_system2!(T1, T2);
impl_system2!(T1, T2, T3);
