use std::{
    any::{Any, TypeId},
    collections::HashMap,
    fmt::Debug,
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

#[derive(Debug)]
pub struct Res<'a, T: 'static> {
    pub value: &'a T,
}

pub trait SystemParam {
    type Item<'new>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r>;
}

impl<'res, T: 'static> SystemParam for Res<'res, T> {
    type Item<'new> = Res<'new, T>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r> {
        Res {
            value: resources.get::<T>(),
        }
    }
}

impl<T: 'static> Deref for Res<'_, T> {
    type Target = T;

    fn deref(&self) -> &T { self.value }
}

pub struct ResMut<'a, T: 'static> {
    pub value: &'a mut T,
}

impl<T: 'static> Deref for ResMut<'_, T> {
    type Target = T;

    fn deref(&self) -> &T { self.value }
}

impl<T: 'static> DerefMut for ResMut<'_, T> {
    fn deref_mut(&mut self) -> &mut T { self.value }
}

impl<'res, T: 'static> SystemParam for ResMut<'res, T> {
    type Item<'new> = ResMut<'new, T>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r> {
        ResMut {
            value: resources.get_mut::<T>(),
        }
    }
}

// pub struct ResourceHandle(u64);

// impl ResourceHandle {
//     pub fn new() -> Self {
//         static COUNTER: AtomicU64 = AtomicU64::new(0);
//         let id = COUNTER.fetch_add(1, Ordering::Relaxed);
//         ResourceHandle(id)
//     }
// }

#[derive(Default)]
pub struct Resources {
    resources: HashMap<TypeId, Resource>,
}

#[derive(Clone, Copy, Debug)]
pub struct Ptr<'a> {
    value: *mut u8,
    marker: PhantomData<&'a mut u8>,
}

#[derive(Debug)]
pub struct Resource {
    boxed: Box<dyn Any>,
}

impl Resource {
    pub fn new<T: 'static>(value: T) -> Self {
        let boxed = Box::new(value) as Box<dyn Any>;
        Resource { boxed }
    }

    fn as_ptr(&self) -> Ptr {
        let ptr = &*self.boxed as *const dyn Any;
        let ptr2 = ptr as *mut u8;
        Ptr::new(ptr2)
    }
}

impl<'a> Ptr<'a> {
    pub fn new(value: *mut u8) -> Self {
        Self {
            value,
            marker: PhantomData,
        }
    }

    pub fn as_mut<T>(self) -> &'a mut T { unsafe { &mut *(self.value as *mut T) } }

    pub fn as_ref<T>(self) -> &'a T { unsafe { &*(self.value as *const T) } }
}

impl Resources {
    pub fn add<T: 'static>(&mut self, value: T) {
        let type_id = TypeId::of::<T>();
        let resource = Resource::new(value);
        self.resources.insert(type_id, resource);
    }

    pub fn get<'a, T: 'static>(&self) -> &T {
        let type_id = TypeId::of::<T>();
        let ptr = self.get_ptr(type_id);
        ptr.as_ref()
    }

    pub fn get_mut<'a, T: 'static>(&'a self) -> &'a mut T {
        let type_id = TypeId::of::<T>();
        let ptr = self.get_ptr(type_id);
        ptr.as_mut()
    }

    pub fn get_ptr<'a>(&'a self, type_id: TypeId) -> Ptr<'a> {
        let resource = self.resources.get(&type_id).unwrap();
        resource.as_ptr()
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
}

impl<F> System for FunctionSystem<(), F>
where
    for<'a> &'a mut F: FnMut() + FnMut(),
{
    fn run(&mut self, _resources: &mut Resources) {
        fn call_inner(mut f: impl FnMut()) { f() }
        call_inner(&mut self.f);
    }

    fn name(&self) -> &str { &self.name }
}

impl<F: FnMut()> IntoSystem<()> for F
where
    for<'a> &'a mut F: FnMut() + FnMut(),
{
    type System = FunctionSystem<(), Self>;

    fn into_system(self) -> Self::System {
        FunctionSystem {
            name: std::any::type_name_of_val(&self).to_string(),
            f: self,
            marker: Default::default(),
        }
    }
}

macro_rules! impl_system {
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

impl_system!(T1);
impl_system!(T1, T2);
impl_system!(T1, T2, T3);
impl_system!(T1, T2, T3, T4);
impl_system!(T1, T2, T3, T4, T5);
impl_system!(T1, T2, T3, T4, T5, T6);
impl_system!(T1, T2, T3, T4, T5, T6, T7);
impl_system!(T1, T2, T3, T4, T5, T6, T7, T8);
impl_system!(T1, T2, T3, T4, T5, T6, T7, T8, T9);

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_run_system() {
        let mut resources = Resources::default();

        let mut scheduler = Scheduler::default();
        scheduler.add_system(Schedule::Default, || {
            assert!(true);
        });

        scheduler.run(Schedule::Default, &mut resources);
    }

    #[test]
    fn test_param() {
        let mut resources = Resources::default();
        resources.add(42i32);

        let mut scheduler = Scheduler::default();
        scheduler.add_system(Schedule::Default, |v: Res<i32>| {
            assert_eq!(*v, 42);
        });

        scheduler.run(Schedule::Default, &mut resources);
    }

    #[test]
    fn test_mut_param() {
        let mut resources = Resources::default();
        resources.add(42i32);

        let mut scheduler = Scheduler::default();
        scheduler.add_system(Schedule::Default, |mut v: ResMut<i32>| {
            *v += 1;
            assert_eq!(*v, 43);
        });

        scheduler.run(Schedule::Default, &mut resources);
        assert_eq!(*resources.get::<i32>(), 43);
    }
}
