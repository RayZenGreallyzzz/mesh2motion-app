export const T = {
  shirt:'Футболка', jacket:'Куртка', pants:'Брюки', puffed:'Дутые штаны',
  dress:'Платье', bracers:'Нарукавники', gloves:'Перчатки', boots:'Сапоги', armor:'Доспех'
} as const
export type GarmentType=keyof typeof T
