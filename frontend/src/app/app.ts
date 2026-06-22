import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Upload } from './upload/upload';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Upload],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {

}
